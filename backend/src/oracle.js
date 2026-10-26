import { keccak256, toUtf8Bytes, formatEther } from "ethers";
import { REGIONS, config } from "./config.js";
import { contract, readContract, chainError, sendTx } from "./chain.js";
import { getDailyFrost, isoToInt, todayIso } from "./weather.js";

function eventIdFromReceipt(receipt) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "FrostReported") return Number(parsed.args.eventId);
    } catch {
      /* лог од друг договор */
    }
  }
  throw new Error("Во трансакцијата нема FrostReported настан");
}

async function sendReport({ region, date, minTempTenths, hoursBelow0, hoursBelowM2, dataHash }) {
  const receipt = await sendTx((o) =>
    contract.reportFrost(region, date, minTempTenths, hoursBelow0, hoursBelowM2, dataHash, o),
  );
  const eventId = eventIdFromReceipt(receipt);
  const claims = config.autoClaim ? await autoClaim(eventId) : [];
  return { eventId, txHash: receipt.hash, claims };
}

/** Ги зема вистинските податоци од Open-Meteo и, ако имало мраз, го пријавува на синџирот. */
export async function reportFromWeather(regionId, dateIso) {
  const w = await getDailyFrost(regionId, dateIso);
  const summary = {
    region: w.region.name,
    date: w.date,
    minTempC: w.minTempC,
    hoursBelow0: w.hoursBelow0,
    hoursBelowM2: w.hoursBelowM2,
    source: w.source,
  };
  if (!w.isFrost) return { reported: false, reason: "Немало мраз (минимум над 0 °C).", ...summary };

  const result = await sendReport({
    region: Number(regionId),
    date: isoToInt(dateIso),
    minTempTenths: w.minTempTenths,
    hoursBelow0: w.hoursBelow0,
    hoursBelowM2: w.hoursBelowM2,
    dataHash: w.dataHash,
  });
  return { reported: true, ...summary, ...result };
}

/** Демо: рачно внесен мраз (за презентации, кога надвор нема мраз). */
export async function reportSimulated({ region, date, minTemp, hoursBelow0, hoursBelowM2 }) {
  const minTempTenths = Math.floor(Number(minTemp) * 10);
  const payload = { simulated: true, region: Number(region), date, minTemp: Number(minTemp), hoursBelow0, hoursBelowM2 };
  const result = await sendReport({
    region: Number(region),
    date: isoToInt(date),
    minTempTenths,
    hoursBelow0: Number(hoursBelow0),
    hoursBelowM2: Number(hoursBelowM2),
    dataHash: keccak256(toUtf8Bytes(JSON.stringify(payload))),
  });
  return { reported: true, simulated: true, ...result };
}

/**
 * Ги исплаќа сите полиси што ги покрива настанот. Договорот сам проверува регион,
 * сезона и износ; backend-от само ја плаќа провизијата (gas) за земјоделците.
 */
export async function autoClaim(eventId) {
  const e = await readContract.getFrostEvent(eventId);
  const count = Number(await readContract.policyCount());
  const results = [];
  for (let id = 0; id < count; id++) {
    const p = await readContract.getPolicy(id);
    if (Number(p.region) !== Number(e.region)) continue;
    const [damageBps, amount] = await readContract.previewClaim(id, eventId);
    if (amount === 0n) continue;
    try {
      const receipt = await sendTx((o) => contract.claim(id, eventId, o));
      results.push({ policyId: id, farmer: p.farmer, damagePct: Number(damageBps) / 100, amount: formatEther(amount), txHash: receipt.hash });
    } catch (err) {
      results.push({ policyId: id, error: chainError(err) });
    }
  }
  return results;
}

/** Дневна задача: го проверува претходниот ден за секој регион. */
export async function runDailyCheck(dateIso = todayIso(-1)) {
  const out = [];
  for (const r of REGIONS) {
    try {
      out.push(await reportFromWeather(r.id, dateIso));
    } catch (err) {
      out.push({ region: r.name, date: dateIso, error: chainError(err) });
    }
  }
  console.log(`[${new Date().toISOString()}] Дневна проверка за ${dateIso}:`, JSON.stringify(out));
  return out;
}

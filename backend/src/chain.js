import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, JsonRpcProvider, Wallet, formatEther } from "ethers";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const deploymentPath = path.join(__dirname, "..", "contract.json");

if (!fs.existsSync(deploymentPath)) {
  console.error("Нема contract.json. Прво деплојувај го договорот: cd contracts && npm run deploy:local");
  process.exit(1);
}

export const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
// cacheTimeout: -1 – без кеширање, за nonce и состојба секогаш да се свежи.
export const provider = new JsonRpcProvider(config.rpcUrl, undefined, { cacheTimeout: -1 });
export const oracleWallet = new Wallet(config.oraclePrivateKey, provider);

// Сите трансакции на оракулот се праќаат една по една, со nonce што го водиме ние.
let queue = Promise.resolve();
let nextNonce = null;

/**
 * sendTx(overrides => contract.someFn(..., overrides)) – ја праќа трансакцијата во ред
 * и чека потврда. При грешка, nonce-от повторно се чита од мрежата.
 */
export function sendTx(build) {
  const run = queue.then(async () => {
    try {
      if (nextNonce === null) nextNonce = await provider.getTransactionCount(oracleWallet.address, "pending");
      const tx = await build({ nonce: nextNonce });
      nextNonce++;
      return await tx.wait();
    } catch (err) {
      nextNonce = null;
      throw err;
    }
  });
  queue = run.catch(() => {});
  return run;
}
export const contract = new Contract(deployment.address, deployment.abi, oracleWallet);
export const readContract = new Contract(deployment.address, deployment.abi, provider);

/** Преведува грешка од договорот во разбирлива порака. */
export function chainError(err) {
  const name = err?.revert?.name || err?.info?.error?.data?.name;
  const messages = {
    InvalidInput: "Невалидни податоци (или настанот за тој регион и датум е веќе пријавен).",
    NotCovered: "Настанот не е покриен со полисата (друг регион или надвор од сезоната).",
    AlreadyClaimed: "Исплатата за овој настан е веќе направена.",
    InsufficientPool: "Нема доволно средства во базенот.",
    NothingToPay: "Нема штета за исплата.",
    FutureDate: "Датумот на мразот е во иднина според времето на синџирот. На локална мрежа прво помести го времето.",
    AccessControlUnauthorizedAccount: "Паричникот на оракулот нема дозвола (ORACLE_ROLE).",
  };
  return messages[name || decodeErrorName(err)] || err?.shortMessage || err?.message || String(err);
}

/** Го наоѓа revert data-то каде и да е закопано во грешката и го декодира со ABI-то. */
function decodeErrorName(err) {
  const seen = new Set();
  const stack = [err];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
    seen.add(cur);
    if (typeof cur.data === "string" && cur.data.startsWith("0x") && cur.data.length >= 10) {
      try {
        const parsed = readContract.interface.parseError(cur.data);
        if (parsed) return parsed.name;
      } catch {
        /* не е грешка од нашиот договор */
      }
    }
    if (typeof cur.message === "string") {
      const m = cur.message.match(/custom error '?(\w+)\(/) || cur.message.match(/reverted with custom error '(\w+)/);
      if (m) return m[1];
    }
    for (const v of Object.values(cur)) if (v && typeof v === "object") stack.push(v);
  }
  return undefined;
}

export function eventToJson(id, e) {
  return {
    id: Number(id),
    region: Number(e.region),
    date: Number(e.date),
    minTemp: Number(e.minTemp) / 10,
    hoursBelow0: Number(e.hoursBelow0),
    hoursBelowM2: Number(e.hoursBelowM2),
    dataHash: e.dataHash,
    reportedAt: Number(e.reportedAt),
    reporter: e.reporter,
  };
}

export function policyToJson(id, p) {
  return {
    id: Number(id),
    farmer: p.farmer,
    region: Number(p.region),
    crop: Number(p.crop),
    prodType: Number(p.prodType),
    areaM2: Number(p.areaM2),
    seasonStart: Number(p.seasonStart),
    seasonEnd: Number(p.seasonEnd),
    coverage: formatEther(p.coverage),
    premium: formatEther(p.premium),
    paidOut: formatEther(p.paidOut),
    createdAt: Number(p.createdAt),
  };
}

import express from "express";
import cors from "cors";
import cron from "node-cron";
import { formatEther } from "ethers";
import { REGIONS, CROPS, PROD_TYPES, config } from "./config.js";
import { deployment, readContract, oracleWallet, provider, chainError, eventToJson, policyToJson } from "./chain.js";
import { getDailyFrost, getFrostForecast, todayIso } from "./weather.js";
import { reportFromWeather, reportSimulated, autoClaim, runDailyCheck } from "./oracle.js";

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(err);
    res.status(400).json({ error: chainError(err) });
  });

function requireKey(req, res, next) {
  if (req.get("x-api-key") !== config.apiKey) return res.status(401).json({ error: "Погрешен API клуч на оракулот." });
  next();
}

// ---------- Јавни ----------

app.get("/api/health", wrap(async (_req, res) => {
  const block = await provider.getBlock("latest");
  res.json({ ok: true, block: block.number, chainTime: block.timestamp, oracle: await oracleWallet.getAddress() });
}));

app.get("/api/meta", (_req, res) => {
  res.json({ regions: REGIONS, crops: CROPS, prodTypes: PROD_TYPES, address: deployment.address, chainId: deployment.chainId });
});

app.get("/api/weather/:region", wrap(async (req, res) => {
  const date = req.query.date || todayIso(-1);
  res.json(await getDailyFrost(req.params.region, date));
}));

app.get("/api/forecast/:region", wrap(async (req, res) => {
  res.json(await getFrostForecast(req.params.region));
}));

app.get("/api/stats", wrap(async (_req, res) => {
  const [pool, free, active, policies, events, claims] = await Promise.all([
    readContract.poolBalance(),
    readContract.freeLiquidity(),
    readContract.totalCoverageActive(),
    readContract.policyCount(),
    readContract.eventCount(),
    readContract.claimCount(),
  ]);
  let paid = 0n;
  for (let i = 0; i < Number(claims); i++) paid += (await readContract.getClaim(i)).amount;
  res.json({
    pool: formatEther(pool),
    freeLiquidity: formatEther(free),
    coverageActive: formatEther(active),
    totalPaid: formatEther(paid),
    policies: Number(policies),
    events: Number(events),
    claims: Number(claims),
  });
}));

app.get("/api/events", wrap(async (_req, res) => {
  const n = Number(await readContract.eventCount());
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const e = await readContract.getFrostEvent(i);
    const damage = [];
    for (let c = 0; c < CROPS.length; c++) {
      const row = [];
      for (let p = 0; p < PROD_TYPES.length; p++) row.push(Number(await readContract.damageForEvent(c, p, i)) / 100);
      damage.push(row);
    }
    out.push({ ...eventToJson(i, e), damagePct: damage });
  }
  res.json(out);
}));

app.get("/api/policies", wrap(async (req, res) => {
  const n = Number(await readContract.policyCount());
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(policyToJson(i, await readContract.getPolicy(i)));
  const farmer = req.query.farmer?.toLowerCase();
  res.json(farmer ? out.filter((p) => p.farmer.toLowerCase() === farmer) : out);
}));

// ---------- Оракул (бара x-api-key) ----------

app.post("/api/oracle/report", requireKey, wrap(async (req, res) => {
  const { region, date } = req.body;
  res.json(await reportFromWeather(region, date || todayIso(-1)));
}));

app.post("/api/oracle/simulate", requireKey, wrap(async (req, res) => {
  const { region, date, minTemp, hoursBelow0, hoursBelowM2 } = req.body;
  if ([region, date, minTemp, hoursBelow0, hoursBelowM2].some((v) => v === undefined || v === "")) {
    return res.status(400).json({ error: "Потребни се region, date, minTemp, hoursBelow0, hoursBelowM2." });
  }
  res.json(await reportSimulated({ region, date, minTemp, hoursBelow0, hoursBelowM2 }));
}));

app.post("/api/oracle/auto-claim", requireKey, wrap(async (req, res) => {
  res.json(await autoClaim(Number(req.body.eventId)));
}));

app.post("/api/oracle/run-daily", requireKey, wrap(async (req, res) => {
  res.json(await runDailyCheck(req.body?.date));
}));

// ---------- Само за локален Hardhat: поместување на времето на синџирот (демо) ----------

app.post("/api/dev/time", requireKey, wrap(async (req, res) => {
  if (deployment.chainId !== 31337) return res.status(403).json({ error: "Достапно само на локалната Hardhat мрежа." });
  const target = Math.floor(Date.parse(`${req.body.date}T08:00:00Z`) / 1000);
  if (!Number.isFinite(target)) return res.status(400).json({ error: "Невалиден датум." });
  const now = (await provider.getBlock("latest")).timestamp;
  if (target <= now) return res.status(400).json({ error: "Времето на синџирот може да оди само напред." });
  await provider.send("evm_setNextBlockTimestamp", [target]);
  await provider.send("evm_mine", []);
  res.json({ chainTime: target });
}));

if (config.cronEnabled) {
  cron.schedule(config.cronSchedule, () => runDailyCheck().catch(console.error), { timezone: config.timezone });
  console.log(`Дневната проверка за мраз е закажана: "${config.cronSchedule}" (${config.timezone})`);
}

app.listen(config.port, async () => {
  console.log(`FrostShield API: http://localhost:${config.port}`);
  console.log(`Договор: ${deployment.address} (chainId ${deployment.chainId})`);
  console.log(`Оракул:  ${await oracleWallet.getAddress()}`);
});

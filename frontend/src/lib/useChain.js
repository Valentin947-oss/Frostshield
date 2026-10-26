import { useCallback, useEffect, useState } from "react";
import { readContract, readProvider } from "./chain.js";

/** Ја чита целата јавна состојба на договорот. Се освежува на секој нов блок. */
export function useChainState() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [pool, free, active, nPol, nEv, nCl, cropParams, protection, premiumRate, waitingPeriod, block] = await Promise.all([
        readContract.poolBalance(),
        readContract.freeLiquidity(),
        readContract.totalCoverageActive(),
        readContract.policyCount(),
        readContract.eventCount(),
        readContract.claimCount(),
        readContract.getAllCropParams(),
        readContract.getAllProtection(),
        readContract.premiumRateBps(),
        readContract.waitingPeriod(),
        readProvider.getBlock("latest"),
      ]);
      const events = await Promise.all(
        Array.from({ length: Number(nEv) }, (_, i) => readContract.getFrostEvent(i).then((e) => ({ id: i, ...plainEvent(e) }))),
      );
      const claims = await Promise.all(
        Array.from({ length: Number(nCl) }, (_, i) => readContract.getClaim(i).then((c) => ({ id: i, ...plainClaim(c) }))),
      );
      const policies = await Promise.all(
        Array.from({ length: Number(nPol) }, (_, i) => readContract.getPolicy(i).then((p) => ({ id: i, ...plainPolicy(p) }))),
      );
      setState({
        pool, free, active,
        totalPaid: claims.reduce((s, c) => s + c.amount, 0n),
        events: events.reverse(),
        claims: claims.reverse(),
        policies,
        cropParams: cropParams.map((p) => ({
          criticalTemp: Number(p.criticalTemp),
          bpsPerDegree: Number(p.bpsPerDegree),
          bpsPerHourBelow0: Number(p.bpsPerHourBelow0),
          bpsPerHourBelowM2: Number(p.bpsPerHourBelowM2),
        })),
        protection: protection.map(Number),
        premiumRate: Number(premiumRate),
        waitingDays: Number(waitingPeriod) / 86400,
        chainTime: block.timestamp,
      });
      setError(null);
    } catch (err) {
      setError("Не може да се прочита синџирот. Дали работи RPC јазолот и дали договорот е деплојуван?");
      console.error(err);
    }
  }, []);

  useEffect(() => {
    load();
    readProvider.on("block", load);
    return () => {
      readProvider.off("block", load);
    };
  }, [load]);

  return { state, error, reload: load };
}

function plainEvent(e) {
  return {
    region: Number(e.region),
    date: Number(e.date),
    minTemp: Number(e.minTemp),
    hoursBelow0: Number(e.hoursBelow0),
    hoursBelowM2: Number(e.hoursBelowM2),
    dataHash: e.dataHash,
    reportedAt: Number(e.reportedAt),
    reporter: e.reporter,
  };
}

function plainClaim(c) {
  return {
    policyId: Number(c.policyId),
    eventId: Number(c.eventId),
    damageBps: Number(c.damageBps),
    amount: c.amount,
    paidAt: Number(c.paidAt),
  };
}

function plainPolicy(p) {
  return {
    farmer: p.farmer,
    region: Number(p.region),
    crop: Number(p.crop),
    prodType: Number(p.prodType),
    areaM2: Number(p.areaM2),
    seasonStart: Number(p.seasonStart),
    seasonEnd: Number(p.seasonEnd),
    coverage: p.coverage,
    premium: p.premium,
    paidOut: p.paidOut,
    createdAt: Number(p.createdAt),
  };
}

/**
 * Истата формула како estimateDamage во договорот – за моментален приказ без RPC повик.
 * Договорот останува извор на вистината за исплатите.
 */
export function estimateDamageLocal(params, protectionBps, minTemp, h0, hm2) {
  let raw = 0;
  if (minTemp < params.criticalTemp) raw += Math.floor(((params.criticalTemp - minTemp) * params.bpsPerDegree) / 10);
  if (minTemp <= params.criticalTemp) raw += h0 * params.bpsPerHourBelow0 + hm2 * params.bpsPerHourBelowM2;
  raw = Math.min(raw, 10000);
  return Math.floor((raw * protectionBps) / 10000);
}

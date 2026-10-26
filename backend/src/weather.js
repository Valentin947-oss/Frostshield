import { keccak256, toUtf8Bytes } from "ethers";
import { REGIONS, config } from "./config.js";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";

/** "2027-03-15" -> 20270315 */
export function isoToInt(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Невалиден датум: ${iso}`);
  return Number(iso.replaceAll("-", ""));
}

/** 20270315 -> "2027-03-15" */
export function intToIso(n) {
  const s = String(n);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

export function todayIso(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone }).format(d);
}

function daysAgo(iso) {
  return Math.round((Date.parse(todayIso()) - Date.parse(iso)) / 864e5);
}

function getRegion(regionId) {
  const r = REGIONS[Number(regionId)];
  if (!r) throw new Error(`Непознат регион: ${regionId}`);
  return r;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo врати ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Ги пресметува показателите за мраз од часовни температури (°C).
 * Враќа вредности во форматот што го очекува договорот.
 */
export function computeFrostMetrics(temps) {
  const valid = temps.filter((t) => typeof t === "number" && Number.isFinite(t));
  if (valid.length === 0) throw new Error("Нема температурни податоци за тој ден");
  const min = Math.min(...valid);
  return {
    minTempC: min,
    minTempTenths: Math.floor(min * 10), // заокружено надолу, во корист на земјоделецот
    hoursBelow0: valid.filter((t) => t < 0).length,
    hoursBelowM2: valid.filter((t) => t < -2).length,
    hoursMeasured: valid.length,
  };
}

/** Детерминистички хеш на суровите податоци – се запишува на синџирот за ревизија. */
export function hashHourly(regionId, dateIso, time, temps) {
  const canonical = JSON.stringify({ regionId: Number(regionId), date: dateIso, time, temperature_2m: temps });
  return keccak256(toUtf8Bytes(canonical));
}

/** Часовни температури за еден ден во даден регион (Open-Meteo, без API клуч). */
export async function getDailyFrost(regionId, dateIso) {
  const r = getRegion(regionId);
  isoToInt(dateIso);
  const base = daysAgo(dateIso) > 60 ? ARCHIVE_URL : FORECAST_URL;
  const params = new URLSearchParams({
    latitude: r.lat,
    longitude: r.lon,
    hourly: "temperature_2m",
    start_date: dateIso,
    end_date: dateIso,
    timezone: config.timezone,
  });
  const data = await fetchJson(`${base}?${params}`);
  const time = data.hourly?.time ?? [];
  const temps = data.hourly?.temperature_2m ?? [];
  const metrics = computeFrostMetrics(temps);
  return {
    region: r,
    date: dateIso,
    source: base.includes("archive") ? "open-meteo-archive" : "open-meteo-forecast",
    hourly: time.map((t, i) => ({ time: t, temp: temps[i] })),
    ...metrics,
    isFrost: metrics.minTempTenths <= 0,
    dataHash: hashHourly(regionId, dateIso, time, temps),
  };
}

/** Прогноза за следните 7 дена: минимални температури и предупредување за мраз. */
export async function getFrostForecast(regionId) {
  const r = getRegion(regionId);
  const params = new URLSearchParams({
    latitude: r.lat,
    longitude: r.lon,
    daily: "temperature_2m_min,temperature_2m_max",
    forecast_days: "7",
    timezone: config.timezone,
  });
  const data = await fetchJson(`${FORECAST_URL}?${params}`);
  const d = data.daily ?? {};
  return {
    region: r,
    days: (d.time ?? []).map((date, i) => {
      const min = d.temperature_2m_min[i];
      return {
        date,
        min,
        max: d.temperature_2m_max[i],
        warning: min <= -2 ? "силен мраз" : min <= 0 ? "мраз" : min <= 2 ? "ризик од слана" : null,
      };
    }),
  };
}

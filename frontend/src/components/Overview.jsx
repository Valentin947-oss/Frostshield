import { useEffect, useMemo, useState } from "react";
import { REGIONS, fmtToken, fmtDateInt } from "../lib/chain.js";
import { estimateDamageLocal } from "../lib/useChain.js";
import { api } from "../lib/api.js";
import { ThermoScale, DamageMatrix } from "./Visuals.jsx";

export default function Overview({ state, onNavigate }) {
  const latest = state.events[0];

  const damage = useMemo(() => {
    if (!latest) return null;
    return state.cropParams.map((p) =>
      state.protection.map((prot) => estimateDamageLocal(p, prot, latest.minTemp, latest.hoursBelow0, latest.hoursBelowM2)),
    );
  }, [latest, state.cropParams, state.protection]);

  const paidForLatest = latest
    ? state.claims.filter((c) => c.eventId === latest.id).reduce((s, c) => s + c.amount, 0n)
    : 0n;

  return (
    <>
      <section className="hero">
        {latest ? (
          <>
            <p className="hero-where">
              Последен мраз: {REGIONS[latest.region]}, {fmtDateInt(latest.date)}
            </p>
            <h1 className="hero-temp">{(latest.minTemp / 10).toFixed(1).replace("-", "−")}<span>°C</span></h1>
            <p className="hero-sub">
              {latest.hoursBelow0} часа под 0 °C, од нив {latest.hoursBelowM2} под −2 °C.
              {paidForLatest > 0n ? ` Договорот автоматски исплати ${fmtToken(paidForLatest)} на земјоделците.` : " Нема исплати за овој мраз."}
            </p>
            <ThermoScale minTemp={latest.minTemp} cropParams={state.cropParams} />
          </>
        ) : (
          <>
            <h1 className="hero-title">Мразот во март не мора да значи изгубена сезона.</h1>
            <p className="hero-sub">
              Осигурај го расадот од домати, пиперки, краставици или салата. Кога оракулот ќе забележи мраз во твојот
              регион, договорот сам ја пресметува штетата и ја исплаќа, без пријава и без чекање на комисија за увид.
            </p>
            <button className="btn primary" onClick={() => onNavigate("buy")}>Купи полиса</button>
          </>
        )}
      </section>

      <section className="figures" aria-label="Состојба на базенот">
        <Figure label="Средства во базенот" value={fmtToken(state.pool, 2)} />
        <Figure label="Резервирано за полиси" value={fmtToken(state.active, 2)} />
        <Figure label="Исплатено на земјоделци" value={fmtToken(state.totalPaid, 2)} />
        <Figure label="Полиси / мразеви" value={`${state.policies.length} / ${state.events.length}`} />
      </section>

      {damage && (
        <section className="panel">
          <h2>Проценета штета од последниот мраз</h2>
          <p className="muted">
            Пресметано со јавниот модел од договорот. Пластениците ја намалуваат штетата, а салатата поднесува пониски температури.
          </p>
          <DamageMatrix damage={damage} />
        </section>
      )}

      <Forecast />
    </>
  );
}

function Figure({ label, value }) {
  return (
    <div className="figure">
      <span className="figure-value">{value}</span>
      <span className="figure-label">{label}</span>
    </div>
  );
}

function Forecast() {
  const [region, setRegion] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api.forecast(region).then(setData).catch((e) => setError(e.message));
  }, [region]);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Прогноза за мраз, наредни 7 дена</h2>
        <select value={region} onChange={(e) => setRegion(Number(e.target.value))} aria-label="Регион">
          {REGIONS.map((r, i) => <option key={r} value={i}>{r}</option>)}
        </select>
      </div>
      {error && <p className="muted">Прогнозата не е достапна: {error}</p>}
      {!data && !error && <p className="muted">Ја вчитувам прогнозата…</p>}
      {data && (
        <ol className="forecast">
          {data.days.map((d) => (
            <li key={d.date} className={d.warning ? "warn" : ""}>
              <span className="fc-day">{new Date(d.date).toLocaleDateString("mk-MK", { weekday: "short", day: "numeric" })}</span>
              <span className="fc-min">{Math.round(d.min)}°</span>
              <span className="fc-max">{Math.round(d.max)}°</span>
              <span className="fc-warn">{d.warning || "без ризик"}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

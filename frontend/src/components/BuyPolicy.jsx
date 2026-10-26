import { useMemo, useState } from "react";
import { parseEther } from "ethers";
import { REGIONS, CROPS, PROD_TYPES, NETWORK, fmtToken, fmtPct, isoToInt, explainError } from "../lib/chain.js";
import { estimateDamageLocal } from "../lib/useChain.js";

/** Наредната сезона февруари–април според времето на синџирот. */
function seasonYear(chainTime) {
  const d = new Date(chainTime * 1000);
  return d.getUTCFullYear() + (d.getUTCMonth() >= 4 ? 1 : 0);
}

export default function BuyPolicy({ state, wallet, onConnect, onDone, notify }) {
  const nextYear = seasonYear(state.chainTime);
  const [form, setForm] = useState({
    region: 0, crop: 0, prodType: 0, area: 5000,
    start: `${nextYear}-02-01`, end: `${nextYear}-04-30`, coverage: "2",
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  let coverageWei = 0n;
  try { coverageWei = parseEther(form.coverage || "0"); } catch { coverageWei = 0n; }
  const premium = (coverageWei * BigInt(state.premiumRate)) / 10000n;
  const fits = state.pool >= state.active + coverageWei;

  const examples = useMemo(() => {
    const p = state.cropParams[Number(form.crop)];
    const prot = state.protection[Number(form.prodType)];
    return [
      { label: "Слаб мраз: −1 °C, 3 часа", bps: estimateDamageLocal(p, prot, -10, 3, 0) },
      { label: "Силен мраз: −3 °C, 6 часа", bps: estimateDamageLocal(p, prot, -30, 6, 2) },
      { label: "Многу силен: −5 °C, 9 часа", bps: estimateDamageLocal(p, prot, -50, 9, 5) },
    ];
  }, [form.crop, form.prodType, state.cropParams, state.protection]);

  async function submit(e) {
    e.preventDefault();
    if (!wallet) return onConnect();
    setBusy(true);
    try {
      const tx = await wallet.contract.buyPolicy(
        Number(form.region), Number(form.crop), Number(form.prodType), Number(form.area),
        isoToInt(form.start), isoToInt(form.end), coverageWei, { value: premium },
      );
      notify({ kind: "info", text: "Трансакцијата е испратена, чекам потврда…" });
      await tx.wait();
      notify({ kind: "ok", text: `Полисата е купена. Платена премија: ${fmtToken(premium)}.`, hash: tx.hash });
      onDone();
    } catch (err) {
      notify({ kind: "error", text: explainError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="split">
      <form className="panel form" onSubmit={submit}>
        <h2>Нова полиса</h2>
        <label>Регион
          <select value={form.region} onChange={set("region")}>{REGIONS.map((r, i) => <option key={r} value={i}>{r}</option>)}</select>
        </label>
        <div className="row">
          <label>Култура
            <select value={form.crop} onChange={set("crop")}>{CROPS.map((c, i) => <option key={c} value={i}>{c}</option>)}</select>
          </label>
          <label>Начин на производство
            <select value={form.prodType} onChange={set("prodType")}>{PROD_TYPES.map((c, i) => <option key={c} value={i}>{c}</option>)}</select>
          </label>
        </div>
        <label>Површина (m²)
          <input type="number" min="1" step="1" value={form.area} onChange={set("area")} required />
        </label>
        <div className="row">
          <label>Сезона од
            <input type="date" value={form.start} onChange={set("start")} required />
          </label>
          <label>до
            <input type="date" value={form.end} onChange={set("end")} required />
          </label>
        </div>
        <label>Покритие ({NETWORK.symbol})
          <input type="number" min="0.001" step="0.001" value={form.coverage} onChange={set("coverage")} required />
          <small>Најмногу толку може да ти се исплати за целата сезона.</small>
        </label>

        <div className="quote">
          <span>Премија ({state.premiumRate / 100} %)</span>
          <strong>{fmtToken(premium)}</strong>
        </div>
        {!fits && <p className="error-text">Базенот моментално не може да го покрие ова покритие. Намали го износот.</p>}

        <button className="btn primary" disabled={busy || !fits || coverageWei === 0n}>
          {!wallet ? "Поврзи паричник" : busy ? "Се купува…" : "Купи полиса"}
        </button>
      </form>

      <aside className="panel">
        <h2>Колку би добил</h2>
        <p className="muted">
          {CROPS[form.crop]}, {PROD_TYPES[form.prodType].toLowerCase()}, покритие {form.coverage || 0} {NETWORK.symbol}.
          Пресметката е истата формула што ја извршува договорот.
        </p>
        <ul className="examples">
          {examples.map((x) => (
            <li key={x.label}>
              <span>{x.label}</span>
              <span className="ex-pct">{x.bps === 0 ? "без штета" : fmtPct(x.bps)}</span>
              <strong>{fmtToken((coverageWei * BigInt(x.bps)) / 10000n)}</strong>
            </li>
          ))}
        </ul>
        <p className="muted small">
          Исплатата следи автоматски кога оракулот ќе пријави мраз во регионот за време на сезоната. Покриен е мраз
          најрано {state.waitingDays} дена по купувањето, па полисата купи пред студот, не после него. Збирот на
          исплатите не може да го надмине покритието.
        </p>
      </aside>
    </div>
  );
}

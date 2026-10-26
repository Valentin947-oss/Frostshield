import { useState } from "react";
import { parseEther } from "ethers";
import { REGIONS, CROPS, PROD_TYPES, NETWORK, CHAIN_ID, explainError, fmtToken, fmtTemp, fmtDateInt, isoToInt } from "../lib/chain.js";
import { api } from "../lib/api.js";

function loadKey() {
  try { return sessionStorage.getItem("oracleKey") || ""; } catch { return ""; }
}

export default function OraclePanel({ state, wallet, onConnect, notify }) {
  const [apiKey, setApiKey] = useState(loadKey);
  const saveKey = (v) => {
    setApiKey(v);
    try { sessionStorage.setItem("oracleKey", v); } catch { /* приватен режим */ }
  };

  return (
    <div className="stack">
      <section className="panel">
        <h2>Пристап до оракулот</h2>
        <p className="muted">Оракулот е backend-от што ги чита временските податоци и ги пријавува мразевите на синџирот.</p>
        <label className="narrow">API клуч на оракулот
          <input type="password" value={apiKey} onChange={(e) => saveKey(e.target.value)} placeholder="ORACLE_API_KEY од backend/.env" />
        </label>
      </section>
      {CHAIN_ID === 31337 && <ChainClock state={state} apiKey={apiKey} notify={notify} />}
      <div className="split">
        <SimulateForm apiKey={apiKey} notify={notify} />
        <RealWeatherForm apiKey={apiKey} notify={notify} />
      </div>
      <FundPool wallet={wallet} onConnect={onConnect} notify={notify} state={state} />
      <ModelParams state={state} wallet={wallet} notify={notify} />
    </div>
  );
}

/** Само за локална мрежа: поместување на времето на синџирот за демо низ сезоната. */
function ChainClock({ state, apiKey, notify }) {
  const nowInt = isoToInt(new Date(state.chainTime * 1000).toISOString().slice(0, 10));
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);

  async function travel(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.timeTravel(date, apiKey);
      notify({ kind: "ok", text: `Времето на синџирот е поместено на ${fmtDateInt(isoToInt(date))}.` });
    } catch (err) {
      notify({ kind: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel form inline" onSubmit={travel}>
      <div>
        <h2>Време на синџирот</h2>
        <p className="muted small">
          Сега: {fmtDateInt(nowInt)}.
          Мраз може да се пријави само за ден што веќе дошол. На локалната мрежа времето може да се помести напред за демото.
        </p>
      </div>
      <label>Помести на
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <button className="btn" disabled={busy}>{busy ? "Се поместува…" : "Помести време"}</button>
    </form>
  );
}

function resultText(r) {
  if (!r.reported) return `${r.region}, ${r.date}: ${r.reason}`;
  const paid = r.claims.filter((c) => c.amount);
  return `Мразот е запишан како настан #${r.eventId}. Автоматски исплатени полиси: ${paid.length}.`;
}

function SimulateForm({ apiKey, notify }) {
  const [f, setF] = useState({ region: 0, date: "", minTemp: "-2.5", hoursBelow0: "5", hoursBelowM2: "2" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.simulate({ ...f, region: Number(f.region) }, apiKey);
      notify({ kind: "ok", text: resultText(r), hash: r.txHash });
    } catch (err) {
      notify({ kind: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel form" onSubmit={submit}>
      <h2>Демо мраз</h2>
      <p className="muted small">За презентација: внеси мраз рачно. Договорот го обработува како вистински.</p>
      <div className="row">
        <label>Регион
          <select value={f.region} onChange={set("region")}>{REGIONS.map((r, i) => <option key={r} value={i}>{r}</option>)}</select>
        </label>
        <label>Датум
          <input type="date" value={f.date} onChange={set("date")} required />
        </label>
      </div>
      <div className="row three">
        <label>Минимум (°C)
          <input type="number" step="0.1" max="0" value={f.minTemp} onChange={set("minTemp")} required />
        </label>
        <label>Часови под 0
          <input type="number" min="0" max="24" value={f.hoursBelow0} onChange={set("hoursBelow0")} required />
        </label>
        <label>Под −2 °C
          <input type="number" min="0" max="24" value={f.hoursBelowM2} onChange={set("hoursBelowM2")} required />
        </label>
      </div>
      <button className="btn primary" disabled={busy}>{busy ? "Се пријавува…" : "Пријави мраз"}</button>
    </form>
  );
}

function RealWeatherForm({ apiKey, notify }) {
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const [region, setRegion] = useState(0);
  const [date, setDate] = useState(yesterday);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    try {
      setPreview(await api.weather(region, date));
    } catch (err) {
      notify({ kind: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function report() {
    setBusy(true);
    try {
      const r = await api.report({ region, date }, apiKey);
      notify({ kind: r.reported ? "ok" : "info", text: resultText(r), hash: r.txHash });
    } catch (err) {
      notify({ kind: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel form">
      <h2>Вистински податоци</h2>
      <p className="muted small">Часовни температури од Open-Meteo. Backend-от ова го прави сам секое утро од февруари до април.</p>
      <div className="row">
        <label>Регион
          <select value={region} onChange={(e) => { setRegion(Number(e.target.value)); setPreview(null); }}>
            {REGIONS.map((r, i) => <option key={r} value={i}>{r}</option>)}
          </select>
        </label>
        <label>Датум
          <input type="date" value={date} max={yesterday} onChange={(e) => { setDate(e.target.value); setPreview(null); }} />
        </label>
      </div>
      {preview && (
        <p className={preview.isFrost ? "frost-yes" : "frost-no"}>
          Минимум {preview.minTempC} °C, {preview.hoursBelow0} часа под 0 °C.{" "}
          {preview.isFrost ? "Имало мраз." : "Немало мраз, нема што да се пријави."}
        </p>
      )}
      <div className="actions">
        <button type="button" className="btn" onClick={check} disabled={busy}>Провери температури</button>
        <button type="button" className="btn primary" onClick={report} disabled={busy || (preview && !preview.isFrost)}>
          Пријави на синџирот
        </button>
      </div>
    </div>
  );
}

function FundPool({ wallet, onConnect, notify, state }) {
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState(false);

  async function fund(e) {
    e.preventDefault();
    if (!wallet) return onConnect();
    setBusy(true);
    try {
      const tx = await wallet.contract.fundPool({ value: parseEther(amount) });
      await tx.wait();
      notify({ kind: "ok", text: `Базенот е наполнет со ${amount} ${NETWORK.symbol}.`, hash: tx.hash });
    } catch (err) {
      notify({ kind: "error", text: explainError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel form inline" onSubmit={fund}>
      <div>
        <h2>Базен на средства</h2>
        <p className="muted small">Слободно за нови полиси: {fmtToken(state.free, 2)}. Секој може да уплати во базенот.</p>
      </div>
      <label>Износ ({NETWORK.symbol})
        <input type="number" min="0.001" step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <button className="btn" disabled={busy}>{!wallet ? "Поврзи паричник" : busy ? "Се уплаќа…" : "Уплати"}</button>
    </form>
  );
}

function ModelParams({ state, wallet, notify }) {
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const tx = await wallet.contract.setCropParams(
        edit.crop, Math.round(Number(edit.criticalTemp) * 10), Number(edit.bpsPerDegree), Number(edit.bpsPerHourBelow0), Number(edit.bpsPerHourBelowM2),
      );
      await tx.wait();
      notify({ kind: "ok", text: `Параметрите за ${CROPS[edit.crop].toLowerCase()} се ажурирани на синџирот.`, hash: tx.hash });
      setEdit(null);
    } catch (err) {
      notify({ kind: "error", text: explainError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Модел за штета</h2>
      <p className="muted">
        Параметрите живеат во договорот и секоја промена е јавна. Тука се внесуваат вредностите калибрирани со
        ML моделот од истражувањето. Менува само паричник со MODEL_ADMIN_ROLE.
      </p>
      <table className="list">
        <thead>
          <tr><th>Култура</th><th>Критична т°</th><th>% по степен</th><th>% по час под 0</th><th>% по час под −2</th><th><span className="sr">Измени</span></th></tr>
        </thead>
        <tbody>
          {state.cropParams.map((p, i) => (
            <tr key={i}>
              <td>{CROPS[i]}</td>
              <td className="num">{fmtTemp(p.criticalTemp)}</td>
              <td className="num">{p.bpsPerDegree / 100}</td>
              <td className="num">{p.bpsPerHourBelow0 / 100}</td>
              <td className="num">{p.bpsPerHourBelowM2 / 100}</td>
              <td>
                {wallet && (
                  <button className="link" onClick={() => setEdit({ crop: i, criticalTemp: p.criticalTemp / 10, ...p })}>Измени</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Заштита: {PROD_TYPES.map((t, i) => `${t.toLowerCase()} ${state.protection[i] / 100} %`).join(", ")} од штетата минува до културата.
      </p>

      {edit && (
        <form className="form edit" onSubmit={save}>
          <h3>{CROPS[edit.crop]}</h3>
          <div className="row four">
            <label>Критична т° (°C)<input type="number" step="0.1" value={edit.criticalTemp} onChange={(e) => setEdit({ ...edit, criticalTemp: e.target.value })} /></label>
            <label>bps по степен<input type="number" min="0" value={edit.bpsPerDegree} onChange={(e) => setEdit({ ...edit, bpsPerDegree: e.target.value })} /></label>
            <label>bps по час под 0<input type="number" min="0" value={edit.bpsPerHourBelow0} onChange={(e) => setEdit({ ...edit, bpsPerHourBelow0: e.target.value })} /></label>
            <label>bps по час под −2<input type="number" min="0" value={edit.bpsPerHourBelowM2} onChange={(e) => setEdit({ ...edit, bpsPerHourBelowM2: e.target.value })} /></label>
          </div>
          <div className="actions">
            <button className="btn primary" disabled={busy}>{busy ? "Се зачувува…" : "Зачувај на синџирот"}</button>
            <button type="button" className="btn" onClick={() => setEdit(null)}>Откажи</button>
          </div>
        </form>
      )}
    </section>
  );
}

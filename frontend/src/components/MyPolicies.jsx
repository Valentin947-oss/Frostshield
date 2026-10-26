import { useEffect, useState } from "react";
import { REGIONS, CROPS, PROD_TYPES, fmtToken, fmtDateInt, fmtPct, fmtTemp, explainError, readContract } from "../lib/chain.js";
import { Meter } from "./Visuals.jsx";

export default function MyPolicies({ state, wallet, onConnect, notify }) {
  if (!wallet) {
    return (
      <section className="panel empty">
        <h2>Твоите полиси</h2>
        <p>Поврзи го паричникот со кој ги купи полисите за да ги видиш исплатите.</p>
        <button className="btn primary" onClick={onConnect}>Поврзи паричник</button>
      </section>
    );
  }

  const mine = state.policies.filter((p) => p.farmer.toLowerCase() === wallet.address.toLowerCase()).reverse();
  if (mine.length === 0) {
    return (
      <section className="panel empty">
        <h2>Сè уште немаш полиса</h2>
        <p>Полисата ја купуваш еднаш за сезоната. Исплатите после мраз доаѓаат автоматски на овој паричник.</p>
      </section>
    );
  }

  return (
    <div className="stack">
      {mine.map((p) => <PolicyCard key={p.id} policy={p} state={state} wallet={wallet} notify={notify} />)}
    </div>
  );
}

function PolicyCard({ policy: p, state, wallet, notify }) {
  const paid = state.claims.filter((c) => c.policyId === p.id);
  const covered = state.events.filter((e) => e.region === p.region && e.date >= p.seasonStart && e.date <= p.seasonEnd);
  const [previews, setPreviews] = useState({});
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all(covered.map((e) => readContract.previewClaim(p.id, e.id).then(([bps, amount]) => [e.id, { bps: Number(bps), amount }])))
      .then((rows) => alive && setPreviews(Object.fromEntries(rows)));
    return () => { alive = false; };
  }, [covered.length, p.paidOut]); // eslint-disable-line react-hooks/exhaustive-deps

  async function claim(eventId) {
    setBusy(eventId);
    try {
      const tx = await wallet.contract.claim(p.id, eventId);
      await tx.wait();
      notify({ kind: "ok", text: "Исплатата е примена на твојот паричник.", hash: tx.hash });
    } catch (err) {
      notify({ kind: "error", text: explainError(err) });
    } finally {
      setBusy(null);
    }
  }

  const open = covered.filter((e) => previews[e.id]?.amount > 0n);

  return (
    <article className="panel policy">
      <header className="policy-head">
        <h2>{CROPS[p.crop]}, {PROD_TYPES[p.prodType].toLowerCase()}</h2>
        <span className="muted">Полиса #{p.id}</span>
      </header>
      <p className="muted">
        {REGIONS[p.region]}, {p.areaM2.toLocaleString("mk-MK")} m², сезона {fmtDateInt(p.seasonStart)} – {fmtDateInt(p.seasonEnd)}
      </p>
      <div className="policy-money">
        <span>Исплатено {fmtToken(p.paidOut)} од {fmtToken(p.coverage)}</span>
        <Meter value={p.paidOut} max={p.coverage} label="Искористено покритие" />
      </div>

      {open.length > 0 && (
        <div className="claim-open">
          <h3>Неисплатени мразеви</h3>
          {open.map((e) => (
            <div key={e.id} className="claim-row">
              <span>{fmtDateInt(e.date)}, {fmtTemp(e.minTemp)}</span>
              <span>{fmtPct(previews[e.id].bps)} штета</span>
              <button className="btn" disabled={busy !== null} onClick={() => claim(e.id)}>
                {busy === e.id ? "Се исплаќа…" : `Исплати ${fmtToken(previews[e.id].amount)}`}
              </button>
            </div>
          ))}
        </div>
      )}

      {paid.length > 0 ? (
        <table className="list">
          <thead><tr><th>Мраз</th><th>Штета</th><th>Исплата</th></tr></thead>
          <tbody>
            {paid.map((c) => {
              const e = state.events.find((x) => x.id === c.eventId);
              return (
                <tr key={c.id}>
                  <td>{fmtDateInt(e.date)}, {fmtTemp(e.minTemp)}</td>
                  <td>{fmtPct(c.damageBps)}</td>
                  <td>{fmtToken(c.amount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        open.length === 0 && (
          <p className="muted small">
            Нема покриен мраз. Покриен е мраз во регионот за време на сезоната, најрано {state.waitingDays} дена по купувањето.
          </p>
        )
      )}
    </article>
  );
}

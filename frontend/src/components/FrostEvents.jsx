import { useState } from "react";
import { REGIONS, fmtDateInt, fmtTemp, fmtToken, shortAddr, CONTRACT_ADDRESS, addressLink } from "../lib/chain.js";
import { estimateDamageLocal } from "../lib/useChain.js";
import { DamageMatrix } from "./Visuals.jsx";

export default function FrostEvents({ state }) {
  const [open, setOpen] = useState(null);
  const link = addressLink(CONTRACT_ADDRESS);

  return (
    <section className="panel">
      <h2>Регистар на мразеви</h2>
      <p className="muted">
        Секој ред е запис во договорот{" "}
        {link ? <a href={link} target="_blank" rel="noreferrer">{shortAddr(CONTRACT_ADDRESS)}</a> : <code>{shortAddr(CONTRACT_ADDRESS)}</code>}.
        Ниту оракулот, ниту администраторот не можат да го сменат или избришат подоцна. Хешот ги заклучува суровите часовни
        податоци од кои е пресметан мразот.
      </p>

      {state.events.length === 0 ? (
        <p className="empty-line">Сè уште нема пријавен мраз.</p>
      ) : (
        <table className="list events">
          <thead>
            <tr>
              <th>Датум</th><th>Регион</th><th>Минимум</th><th>Часови под 0 / −2 °C</th><th>Исплатено</th><th><span className="sr">Детали</span></th>
            </tr>
          </thead>
          <tbody>
            {state.events.map((e) => {
              const paid = state.claims.filter((c) => c.eventId === e.id).reduce((s, c) => s + c.amount, 0n);
              const isOpen = open === e.id;
              return [
                <tr key={e.id} className={isOpen ? "is-open" : ""}>
                  <td>{fmtDateInt(e.date)}</td>
                  <td>{REGIONS[e.region]}</td>
                  <td className="num">{fmtTemp(e.minTemp)}</td>
                  <td className="num">{e.hoursBelow0} / {e.hoursBelowM2}</td>
                  <td className="num">{fmtToken(paid, 3)}</td>
                  <td>
                    <button className="link" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : e.id)}>
                      {isOpen ? "Затвори" : "Штета по култура"}
                    </button>
                  </td>
                </tr>,
                isOpen && (
                  <tr key={`${e.id}-d`} className="detail">
                    <td colSpan={6}>
                      <DamageMatrix
                        damage={state.cropParams.map((p) =>
                          state.protection.map((prot) => estimateDamageLocal(p, prot, e.minTemp, e.hoursBelow0, e.hoursBelowM2)),
                        )}
                      />
                      <p className="muted small">Хеш на податоците: <code>{e.dataHash}</code></p>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

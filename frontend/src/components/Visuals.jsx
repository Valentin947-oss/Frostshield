import { CROPS, PROD_TYPES, fmtPct } from "../lib/chain.js";

const MIN_T = -8;
const MAX_T = 2;

/**
 * Температурна скала: каде падна минимумот наспроти критичната температура на секоја култура.
 * Температурите се во десетинки од степенот, како во договорот.
 */
export function ThermoScale({ minTemp, cropParams }) {
  const W = 520, x0 = 20, x1 = W - 20;
  const X = (tenths) => {
    const t = Math.max(MIN_T, Math.min(MAX_T, tenths / 10));
    return x0 + ((t - MIN_T) / (MAX_T - MIN_T)) * (x1 - x0);
  };
  const ticks = [];
  for (let t = MIN_T; t <= MAX_T; t += 2) ticks.push(t);
  // Културите со иста критична температура се прикажуваат заедно.
  const groups = {};
  cropParams.forEach((p, i) => { (groups[p.criticalTemp] ||= []).push(CROPS[i]); });
  const crops = Object.entries(groups)
    .map(([t, names]) => ({ t: Number(t), name: names.join(", ") }))
    .sort((a, b) => a.t - b.t);
  const mx = X(minTemp);

  return (
    <svg className="thermo" viewBox={`0 0 ${W} 150`} role="img" aria-label={`Минимум ${minTemp / 10} °C наспроти критичните температури на културите`}>
      <defs>
        <linearGradient id="cold" x1="0" x2="1">
          <stop offset="0" stopColor="var(--frost-deep)" />
          <stop offset="0.8" stopColor="var(--frost)" />
          <stop offset="1" stopColor="var(--leaf-soft)" />
        </linearGradient>
      </defs>
      <rect x={x0} y="60" width={x1 - x0} height="14" rx="7" fill="url(#cold)" />
      <rect x={x0} y="60" width={Math.max(0, mx - x0)} height="14" rx="7" fill="var(--ink)" opacity="0.18" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={X(t * 10)} x2={X(t * 10)} y1="78" y2="86" stroke="var(--ink-quiet)" />
          <text x={X(t * 10)} y="100" textAnchor="middle" className="thermo-tick">{String(t).replace("-", "−")}°</text>
        </g>
      ))}
      {crops.map((c, i) => (
        <g key={c.name}>
          <line x1={X(c.t)} x2={X(c.t)} y1="54" y2="80" stroke="var(--ink)" strokeWidth="1.5" />
          <text x={X(c.t)} y={i % 2 ? 40 : 26} textAnchor="middle" className="thermo-crop">{c.name}</text>
          <line x1={X(c.t)} x2={X(c.t)} y1={i % 2 ? 44 : 30} y2="54" stroke="var(--ink-quiet)" strokeDasharray="2 2" />
        </g>
      ))}
      <g>
        <path d={`M${mx} 118 l-7 10 h14 z`} fill="var(--damage)" />
        <text x={mx} y="146" textAnchor="middle" className="thermo-min">минимум {(minTemp / 10).toFixed(1).replace("-", "−")} °C</text>
      </g>
    </svg>
  );
}

/** Штета по култура и тип на производство (bps). Посилна боја = поголема штета. */
export function DamageMatrix({ damage }) {
  return (
    <table className="matrix">
      <thead>
        <tr>
          <th scope="col">Култура</th>
          {PROD_TYPES.map((p) => <th key={p} scope="col">{p}</th>)}
        </tr>
      </thead>
      <tbody>
        {CROPS.map((c, ci) => (
          <tr key={c}>
            <th scope="row">{c}</th>
            {PROD_TYPES.map((p, pi) => {
              const bps = damage[ci][pi];
              return (
                <td key={p} style={{ "--a": (bps / 10000).toFixed(3) }} className={bps === 0 ? "zero" : ""}>
                  {bps === 0 ? "без штета" : fmtPct(bps)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Meter({ value, max, label }) {
  const pct = max > 0n ? Number((value * 10000n) / max) / 100 : 0;
  return (
    <div className="meter" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

"use client";
import { useState } from "react";

/**
 * Single-series weight trend (change-over-time → line). One brand hue, thin
 * 2px line, soft area, emphasized endpoint, recessive grid, crosshair +
 * tooltip on hover. x is spaced evenly by record order (weekly check-ins).
 *
 * The SVG stretches to the container (preserveAspectRatio="none") and draws
 * only strokes/fills (kept crisp with non-scaling-stroke). Dots, hit regions
 * and the tooltip are HTML positioned by percentage, so nothing distorts and
 * the hit targets line up exactly with the points. Body fat is a different
 * scale and never shares this axis (no dual-axis).
 */
export interface WeightPoint { date: string; weight: number }

const W = 100, H = 60, PADL = 9, PADR = 4, PADT = 6, PADB = 12;

export function WeightChart({ data }: { data: WeightPoint[] }) {
  const [active, setActive] = useState<number | null>(null);
  if (data.length === 0) return null;

  const weights = data.map((d) => d.weight);
  let lo = Math.min(...weights), hi = Math.max(...weights);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.18;
  lo -= pad; hi += pad;

  const n = data.length;
  const x = (i: number) => (n === 1 ? (PADL + PADR + W) / 2 - PADR : PADL + (i * (W - PADL - PADR)) / (n - 1));
  const y = (v: number) => PADT + (1 - (v - lo) / (hi - lo)) * (H - PADT - PADB);
  const xPct = (i: number) => (x(i) / W) * 100;
  const yPct = (v: number) => (y(v) / H) * 100;

  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)} ${y(d.weight).toFixed(2)}`).join(" ");
  const areaBase = H - PADB;
  const area = `${line} L${x(n - 1).toFixed(2)} ${areaBase} L${x(0).toFixed(2)} ${areaBase} Z`;
  const grid = [hi - pad, (lo + hi) / 2, lo + pad];
  const md = (s: string) => s.slice(5).replace("-", "/");

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" preserveAspectRatio="none" aria-hidden="true">
        {grid.map((v, i) => (
          <line key={i} x1={PADL} x2={W - PADR} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        {n > 1 && <path d={area} fill="var(--accent-soft)" stroke="none" />}
        {n > 1 && <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />}
        {active !== null && (
          <line x1={x(active)} x2={x(active)} y1={PADT} y2={areaBase} stroke="var(--border-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
      </svg>

      {data.map((d, i) => {
        const on = active === i, isEnd = i === n - 1;
        return (
          <span key={i} className={`chart-dot${on ? " on" : ""}${isEnd ? " end" : ""}`}
            style={{ left: `${xPct(i)}%`, top: `${yPct(d.weight)}%` }} />
        );
      })}

      <div className="chart-ylabels">
        {grid.map((v, i) => <span key={i} style={{ top: `${yPct(v)}%` }}>{Math.round(v * 10) / 10}</span>)}
      </div>

      <div className="chart-hits" onPointerLeave={() => setActive(null)}>
        {data.map((d, i) => (
          <button key={i} type="button" style={{ left: `${xPct(i)}%`, width: `${100 / n}%` }}
            aria-label={`${d.date} ${d.weight}kg`}
            onPointerEnter={() => setActive(i)} onFocus={() => setActive(i)} onClick={() => setActive(i)} />
        ))}
      </div>

      {active !== null && (
        <div className={`chart-tip${xPct(active) > 60 ? " left" : ""}`} style={{ left: `${xPct(active)}%` }}>
          <div className="chart-tip-v">{data[active]!.weight} kg</div>
          <div className="chart-tip-d">{md(data[active]!.date)}</div>
        </div>
      )}

      <div className="chart-xlabels">
        <span>{md(data[0]!.date)}</span>
        {n > 1 && <span>{md(data[n - 1]!.date)}</span>}
      </div>
    </div>
  );
}

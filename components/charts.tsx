"use client";

import { useEffect, useRef, useState } from "react";

export type DayPoint = { day: string; answered: number; escalated: number };

export type Totals = {
  questions30: number;
  questionsPrev30: number;
  answered30: number;
  escalated30: number;
  answerRate30: number | null;
  answerRatePrev30: number | null;
  openCount: number;
  avgReplyHours30: number | null;
  answeredByTeam30: number;
};

const fmtDay = (iso: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, opts);

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

/** A bar whose top two corners are rounded, anchored to the baseline. */
function topRounded(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** Daily questions, stacked by who answered them. Hover shows the day; the table view lists every value. */
export function ActivityChart({ data, title, subtitle }: { data: DayPoint[]; title: string; subtitle?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");
  // Draw at the container's real width so text stays the same size on every screen.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);
  const H = 230;
  const pad = { l: 34, r: 8, t: 12, b: 26 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...data.map((d) => d.answered + d.escalated)));
  const band = plotW / Math.max(1, data.length);
  const barW = Math.max(3, band * 0.62);
  const y = (v: number) => pad.t + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const total = data.reduce((n, d) => n + d.answered + d.escalated, 0);
  const h = hover !== null ? data[hover] : null;

  return (
    <div>
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="legend">
          <span>
            <i className="swatch" style={{ background: "var(--series-1)" }} /> Answered by assistant
          </span>
          <span>
            <i className="swatch" style={{ background: "var(--series-2)" }} /> Sent to you
          </span>
          <div className="seg" role="tablist" aria-label="View">
            <button className={view === "chart" ? "on" : ""} onClick={() => setView("chart")}>
              Chart
            </button>
            <button className={view === "table" ? "on" : ""} onClick={() => setView("table")}>
              Table
            </button>
          </div>
        </div>
      </div>

      {view === "table" ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Day</th>
                <th style={{ textAlign: "right" }}>Answered by assistant</th>
                <th style={{ textAlign: "right" }}>Sent to you</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.day}>
                  <td>{fmtDay(d.day, { weekday: "short", month: "short", day: "numeric" })}</td>
                  <td className="n">{d.answered}</td>
                  <td className="n">{d.escalated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart" ref={box} onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${total} questions over ${data.length} days`}>
            {ticks.map((t) => (
              <g key={t}>
                <line className={t === 0 ? "baseline" : "gridline"} x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
                <text className="axis" x={pad.l - 8} y={y(t) + 4} textAnchor="end">
                  {Number.isInteger(t) ? t : t.toFixed(1)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x = pad.l + band * i + (band - barW) / 2;
              const a = d.answered;
              const e = d.escalated;
              const yA = y(a);
              const hA = pad.t + plotH - yA;
              const yTop = y(a + e);
              const hE = Math.max(0, yA - yTop - (a > 0 && e > 0 ? 2 : 0));
              return (
                <g key={d.day}>
                  {hover === i && <rect x={pad.l + band * i} y={pad.t} width={band} height={plotH} fill="var(--grid)" opacity={0.7} rx={4} />}
                  {a > 0 && <path d={e > 0 ? `M${x},${yA}h${barW}v${hA}h${-barW}Z` : topRounded(x, yA, barW, hA, 4)} fill="var(--series-1)" />}
                  {e > 0 && <path d={topRounded(x, yTop, barW, hE, 4)} fill="var(--series-2)" />}
                  {(i % (W < 480 ? 10 : 7) === (data.length - 1) % (W < 480 ? 10 : 7)) && (
                    <text className="axis" x={x + barW / 2} y={H - 6} textAnchor="middle">
                      {fmtDay(d.day)}
                    </text>
                  )}
                  <rect
                    x={pad.l + band * i}
                    y={0}
                    width={band}
                    height={H}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                  />
                </g>
              );
            })}
          </svg>
          {h && hover !== null && (
            <div
              className="tip"
              style={(() => {
                const barTop = y(h.answered + h.escalated);
                const below = barTop < H * 0.45; // tall bar: show the tip below the pointer so it stays inside the chart
                return {
                  left: `${((pad.l + band * hover + band / 2) / W) * 100}%`,
                  top: `${((below ? pad.t + plotH * 0.35 : barTop - 8) / H) * 100}%`,
                  transform: below ? "translate(-50%, 0)" : undefined,
                };
              })()}
            >
              <b>{fmtDay(h.day, { weekday: "short", month: "short", day: "numeric" })}</b>
              <div className="tip-row">
                <i className="swatch" style={{ background: "var(--series-1)" }} /> Answered by assistant <span className="v">{h.answered}</span>
              </div>
              <div className="tip-row">
                <i className="swatch" style={{ background: "var(--series-2)" }} /> Sent to you <span className="v">{h.escalated}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Small trend line of daily client questions. */
export function Sparkline({ values, days }: { values: number[]; days: string[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 160;
  const H = 34;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? W / (values.length - 1) : W;
  const pts = values.map((v, i) => [i * step, H - 3 - (v / max) * (H - 8)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  const total = values.reduce((a, b) => a + b, 0);
  const i = hover ?? values.length - 1;

  return (
    <div className="spark" onMouseLeave={() => setHover(null)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${total} client questions in the last ${values.length} days`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(values.length - 1, Math.round(((e.clientX - r.left) / r.width) * (values.length - 1)))));
        }}
      >
        <polygon points={area} fill="var(--series-1)" opacity={0.1} />
        <polyline points={line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        style={{
          position: "absolute",
          left: `${(pts[i][0] / W) * 100}%`,
          top: `${(pts[i][1] / H) * 100}%`,
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "var(--series-1)",
          boxShadow: "0 0 0 2px var(--surface)",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }}
      />
      {hover !== null && (
        <div className="tip" style={{ left: `${(pts[i][0] / W) * 100}%`, top: -6, minWidth: 0 }}>
          {fmtDay(days[i])}: <b style={{ display: "inline" }}>{values[i]}</b> question{values[i] === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}

export function Meter({ value }: { value: number | null }) {
  return (
    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? 0 : Math.round(value * 100)}>
      <div style={{ width: `${value === null ? 0 : Math.max(2, value * 100)}%` }} />
    </div>
  );
}

function Delta({ now, before, kind }: { now: number | null; before: number | null; kind: "count" | "rate" }) {
  if (now === null || before === null || (kind === "count" && before === 0)) return null;
  const diff = kind === "rate" ? Math.round((now - before) * 100) : Math.round(((now - before) / before) * 100);
  if (diff === 0) return <span className="delta">No change</span>;
  const up = diff > 0;
  return (
    <span className={`delta ${up ? "up" : "down"}`}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={up ? "M12 19V5M5 12l7-7 7 7" : "M12 5v14M19 12l-7 7-7-7"} />
      </svg>
      {up ? "+" : "−"}
      {Math.abs(diff)}
      {kind === "rate" ? " pts" : "%"}
    </span>
  );
}

export function fmtHours(h: number | null): string {
  if (h === null) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

/** The four headline numbers, used on the dashboard and on each project's Insights tab. */
export function StatTiles({ t, oldestOpen }: { t: Totals; oldestOpen?: string | null }) {
  const pct = t.answerRate30 === null ? null : Math.round(t.answerRate30 * 100);
  const waitDays = oldestOpen ? Math.floor((Date.now() - new Date(oldestOpen).getTime()) / 86_400_000) : null;
  const reply = fmtHours(t.avgReplyHours30);
  const [num, unit] = reply.includes(" ") ? reply.split(" ") : [reply, ""];
  return (
    <div className="tiles">
      <div className="card tile feature">
        <span className="tile-label">Answered by the assistant</span>
        <span className="tile-value">
          {pct === null ? "—" : pct}
          {pct !== null && <small>%</small>}
        </span>
        <Meter value={t.answerRate30} />
        <span className="tile-foot">
          <Delta now={t.answerRate30} before={t.answerRatePrev30} kind="rate" />
          {t.answerRatePrev30 !== null && t.answerRate30 !== null ? "vs previous 30 days" : "Last 30 days"}
        </span>
      </div>
      <div className="card tile">
        <span className="tile-label">Client questions</span>
        <span className="tile-value">{t.questions30}</span>
        <span className="tile-foot">
          <Delta now={t.questions30} before={t.questionsPrev30} kind="count" />
          {t.questionsPrev30 > 0 ? "vs previous 30 days" : "Last 30 days"}
        </span>
      </div>
      <div className="card tile">
        <span className="tile-label">Waiting for your answer</span>
        <span className="tile-value">{t.openCount}</span>
        <span className="tile-foot">
          {t.openCount === 0 ? "You're all caught up" : waitDays !== null ? `Oldest waiting ${waitDays === 0 ? "less than a day" : `${waitDays} day${waitDays === 1 ? "" : "s"}`}` : ""}
        </span>
      </div>
      <div className="card tile">
        <span className="tile-label">Your average reply time</span>
        <span className="tile-value">
          {num}
          {unit && <small>{unit}</small>}
        </span>
        <span className="tile-foot">{t.answeredByTeam30} answered in the last 30 days</span>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { api, timeAgo } from "./client-utils";
import { downloadFile, htmlShell, printHtml, safeFileName } from "./export";
import Modal from "./Modal";

type Item = { title: string; owner_name: string; due_date: string | null; overdue: boolean };
type Status = "On track" | "At risk" | "Blocked" | "No activity";
type RProject = {
  id: string;
  name: string;
  client: string;
  active: boolean;
  status: Status;
  headline: string;
  progress: string[];
  next_steps: string[];
  risks: string[];
  waiting_on_client: Item[];
  waiting_on_us: Item[];
  done_this_week: string[];
  metrics: {
    questions: number;
    answered_by_assistant: number;
    sent_to_team: number;
    answered_by_team: number;
    open_questions: number;
    oldest_open_days: number | null;
    items_done: number;
    overdue: number;
    sources_added: number;
  };
};
type Report = { title: string; period: { start: string; end: string }; generated_at: string; summary: string[]; projects: RProject[] };
type Past = { id: string; title: string; created_at: string };

// The report is styled like a printed page (inline styles), so it looks the same on screen, in PDF and in Word.
const C = { ink: "#111827", muted: "#5b6475", line: "#d9dde5", soft: "#f4f6f9" };
const STATUS: Record<Status, { bg: string; fg: string; mark: string }> = {
  "On track": { bg: "#e3f4e3", fg: "#0a6b0a", mark: "✓" },
  "At risk": { bg: "#fdf0d3", fg: "#7a4d00", mark: "!" },
  Blocked: { bg: "#fbe1e1", fg: "#a61f1f", mark: "■" },
  "No activity": { bg: "#eceef2", fg: "#4b5363", mark: "–" },
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmtDue = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");

function Pill({ s }: { s: Status }) {
  const c = STATUS[s];
  return (
    <span style={{ display: "inline-block", padding: "1px 8px", borderRadius: 10, background: c.bg, color: c.fg, fontWeight: 700, fontSize: "9.5pt", whiteSpace: "nowrap" }}>
      {c.mark} {s}
    </span>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: "2px 0 6px", paddingLeft: 18 }}>
      {items.map((t, i) => (
        <li key={i} style={{ margin: "1px 0" }}>
          {t}
        </li>
      ))}
    </ul>
  );
}

function ItemList({ items }: { items: Item[] }) {
  return (
    <ul style={{ margin: "2px 0 6px", paddingLeft: 18 }}>
      {items.map((i, k) => (
        <li key={k} style={{ margin: "1px 0" }}>
          {i.title}
          {i.owner_name ? <span style={{ color: C.muted }}> ({i.owner_name})</span> : null}
          {i.due_date ? (
            <span style={{ color: i.overdue ? "#a61f1f" : C.muted, fontWeight: i.overdue ? 700 : 400 }}>
              {" "}
              {i.overdue ? `overdue since ${fmtDue(i.due_date)}` : `due ${fmtDue(i.due_date)}`}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

const H3 = ({ children }: { children: React.ReactNode }) => (
  <h3 style={{ fontSize: "10.5pt", margin: "10px 0 2px", color: C.ink, fontFamily: "inherit" }}>{children}</h3>
);

export function ReportView({ r }: { r: Report }) {
  const counts = r.projects.reduce((m, p) => ({ ...m, [p.status]: (m[p.status] || 0) + 1 }), {} as Record<string, number>);
  const th: React.CSSProperties = { border: `1px solid ${C.line}`, padding: "5px 7px", background: C.soft, textAlign: "left", fontWeight: 600, fontSize: "9.5pt", verticalAlign: "bottom" };
  const td: React.CSSProperties = { border: `1px solid ${C.line}`, padding: "5px 7px", verticalAlign: "top", fontSize: "10pt" };
  const num: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
  return (
    <div style={{ fontFamily: 'Calibri, "Segoe UI", Arial, sans-serif', color: C.ink, fontSize: "10.5pt", lineHeight: 1.45 }}>
      <h1 style={{ fontSize: "19pt", margin: "0 0 2px", fontFamily: "inherit", letterSpacing: 0 }}>Weekly project report</h1>
      <div style={{ color: C.muted, marginBottom: 14 }}>
        {fmtDate(r.period.start)} – {fmtDate(r.period.end)}, {r.projects.length} project{r.projects.length === 1 ? "" : "s"}:{" "}
        {(["Blocked", "At risk", "On track", "No activity"] as Status[])
          .filter((s) => counts[s])
          .map((s) => `${counts[s]} ${s.toLowerCase()}`)
          .join(", ")}
      </div>

      {r.summary.length > 0 && (
        <>
          <h2 style={{ fontSize: "13pt", margin: "0 0 2px", fontFamily: "inherit" }}>Summary</h2>
          <List items={r.summary} />
        </>
      )}

      <h2 style={{ fontSize: "13pt", margin: "12px 0 4px", fontFamily: "inherit" }}>At a glance</h2>
      <table style={{ borderCollapse: "collapse", width: "100%", margin: "0 0 14px" }}>
        <thead>
          <tr>
            <th style={th}>Project</th>
            <th style={th}>Status</th>
            <th style={{ ...th, textAlign: "right" }}>Client questions</th>
            <th style={{ ...th, textAlign: "right" }}>Waiting for answer</th>
            <th style={{ ...th, textAlign: "right" }}>Done this week</th>
            <th style={{ ...th, textAlign: "right" }}>Open on client</th>
            <th style={{ ...th, textAlign: "right" }}>Open on us</th>
            <th style={{ ...th, textAlign: "right" }}>Overdue</th>
          </tr>
        </thead>
        <tbody>
          {r.projects.map((p) => (
            <tr key={p.id}>
              <td style={td}>
                <b>{p.name}</b>
                {p.client ? <div style={{ color: C.muted, fontSize: "9pt" }}>{p.client}</div> : null}
              </td>
              <td style={td}>
                <Pill s={p.status} />
              </td>
              <td style={num}>
                {p.metrics.questions}
                {p.metrics.questions > 0 && (
                  <div style={{ color: C.muted, fontSize: "8.5pt" }}>
                    {p.metrics.answered_by_assistant} by assistant
                  </div>
                )}
              </td>
              <td style={{ ...num, color: p.metrics.open_questions ? "#7a4d00" : undefined, fontWeight: p.metrics.open_questions ? 700 : 400 }}>{p.metrics.open_questions}</td>
              <td style={num}>{p.metrics.items_done}</td>
              <td style={num}>{p.waiting_on_client.length}</td>
              <td style={num}>{p.waiting_on_us.length}</td>
              <td style={{ ...num, color: p.metrics.overdue ? "#a61f1f" : undefined, fontWeight: p.metrics.overdue ? 700 : 400 }}>{p.metrics.overdue}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {r.projects.map((p) => (
        <section key={p.id} className="rp-project" style={{ borderTop: `2px solid ${C.line}`, padding: "12px 0 4px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h2 style={{ fontSize: "13.5pt", margin: 0, fontFamily: "inherit" }}>{p.name}</h2>
            {p.client && <span style={{ color: C.muted }}>{p.client}</span>}
            <Pill s={p.status} />
            {!p.active && <span style={{ color: C.muted, fontSize: "9pt" }}>(client link off)</span>}
          </div>
          <p style={{ margin: "4px 0 2px" }}>{p.headline}</p>
          <div style={{ color: C.muted, fontSize: "9pt", marginBottom: 2 }}>
            This week: {p.metrics.questions} client question{p.metrics.questions === 1 ? "" : "s"} ({p.metrics.answered_by_assistant} answered by the assistant,{" "}
            {p.metrics.sent_to_team} sent to the team), {p.metrics.answered_by_team} answered by the team, {p.metrics.sources_added} new source
            {p.metrics.sources_added === 1 ? "" : "s"}.
            {p.metrics.open_questions > 0 &&
              ` ${p.metrics.open_questions} question${p.metrics.open_questions === 1 ? "" : "s"} waiting${p.metrics.oldest_open_days ? `, oldest ${p.metrics.oldest_open_days} day${p.metrics.oldest_open_days === 1 ? "" : "s"}` : ""}.`}
          </div>
          {p.progress.length > 0 && (
            <>
              <H3>Progress this week</H3>
              <List items={p.progress} />
            </>
          )}
          {p.done_this_week.length > 0 && (
            <>
              <H3>Completed</H3>
              <List items={p.done_this_week} />
            </>
          )}
          {p.next_steps.length > 0 && (
            <>
              <H3>Next steps</H3>
              <List items={p.next_steps} />
            </>
          )}
          {p.waiting_on_client.length > 0 && (
            <>
              <H3>Waiting on {p.client || "the client"}</H3>
              <ItemList items={p.waiting_on_client} />
            </>
          )}
          {p.waiting_on_us.length > 0 && (
            <>
              <H3>Waiting on us</H3>
              <ItemList items={p.waiting_on_us} />
            </>
          )}
          {p.risks.length > 0 && (
            <>
              <H3>Risks and blockers</H3>
              <List items={p.risks} />
            </>
          )}
        </section>
      ))}
      <p style={{ color: C.muted, fontSize: "8.5pt", marginTop: 14 }}>
        Generated {new Date(r.generated_at).toLocaleString("en-GB")}. Figures come from the project desk; summaries are written by AI from project emails, documents and the
        tracker.
      </p>
    </div>
  );
}

/** Dashboard button + dialog: write this week's report, view it, download it, reopen past ones. */
export default function WeeklyReportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <path d="M14 3v6h6M8 13h8M8 17h5" />
        </svg>
        Weekly report
      </button>
      {open && <ReportDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ReportDialog({ onClose }: { onClose: () => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [past, setPast] = useState<Past[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const paper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ reports: Past[] }>("/api/admin/reports")
      .then((d) => setPast(d.reports))
      .catch(() => setPast([]));
  }, []);
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const d = await api<{ id: string; report: Report }>("/api/admin/reports", { body: {} });
      setReport(d.report);
      setPast((p) => [{ id: d.id, title: d.report.title, created_at: d.report.generated_at }, ...(p || [])]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openPast(id: string) {
    setError("");
    try {
      setReport((await api<{ report: Report }>(`/api/admin/reports/${id}`)).report);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const fileBase = report ? safeFileName(`Weekly project report ${fmtDate(report.period.end)}`) : "report";
  const html = () => htmlShell(report?.title || "Weekly project report", paper.current?.innerHTML || "");

  return (
    <Modal title={report ? report.title : "Weekly report"} onClose={onClose}>
      <div className="modal-body stack">
        {error && <div className="notice error">{error}</div>}
        {!report ? (
          <div className="stack">
            <p className="muted">
              A summary of every project over the last 7 days: status, progress, what&apos;s waiting on the bank and on us, next steps and risks. The
              figures come straight from the desk, and the summaries are written by AI from your emails, documents and tracker.
            </p>
            <div className="row wrap">
              <button className="btn btn-primary" onClick={generate} disabled={busy}>
                {busy && <span className="spinner" />} {busy ? "Writing report…" : "Write this week's report"}
              </button>
              {busy && <span className="small muted">Usually under a minute ({elapsed}s)</span>}
            </div>
            {past && past.length > 0 && (
              <div className="card" style={{ marginTop: 6 }}>
                <div className="card-head">
                  <h3 className="grow">Previous reports</h3>
                </div>
                <div className="list">
                  {past.map((p) => (
                    <div key={p.id} className="list-item clickable" onClick={() => openPast(p.id)}>
                      <div className="grow ellipsis">{p.title}</div>
                      <span className="tiny muted nowrap">{timeAgo(p.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="report-paper">
            <div ref={paper}>
              <ReportView r={report} />
            </div>
          </div>
        )}
      </div>
      {report && (
        <div className="modal-foot wrap">
          <button className="btn btn-ghost" style={{ marginRight: "auto" }} onClick={() => setReport(null)}>
            All reports
          </button>
          {note && <span className="small muted">{note}</span>}
          <button className="btn" onClick={() => downloadFile(`${fileBase}.doc`, html(), "application/msword")}>
            Download Word
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (!printHtml(html())) setNote("Allow pop-ups for this site to save as PDF.");
              else setNote("Choose “Save as PDF” in the print dialog.");
            }}
          >
            Download PDF
          </button>
        </div>
      )}
    </Modal>
  );
}

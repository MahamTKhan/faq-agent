"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AdminBar from "./AdminBar";
import { ActivityChart, Meter, Sparkline, StatTiles, type DayPoint, type Totals } from "./charts";
import { api, timeAgo } from "./client-utils";

type Health = { level: "good" | "warning" | "critical" | "paused"; label: string; reason: string };
type ProjectRow = {
  id: string;
  name: string;
  client_name: string;
  slug: string;
  active: boolean;
  doc_count: number;
  conversation_count: number;
  last_activity: string | null;
  open_count: number;
  oldest_open: string | null;
  answered: number;
  escalated: number;
  answer_rate: number | null;
  client_items: number;
  overdue_us: number;
  suggested_items: number;
  health: Health;
  spark: number[];
};
type NeedsItem = { id: string; project_id: string; project_name: string; question: string; visitor_email: string; created_at: string };
type Review = { project_id: string; project_name: string; count: number };
type Dashboard = { totals: Totals; daily: DayPoint[]; projects: ProjectRow[]; needsYou: NeedsItem[]; reviews?: Review[]; sparkDays: string[] };

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function HealthBadge({ h }: { h: Health }) {
  return (
    <span className={`health ${h.level}`}>
      <span className="ico" aria-hidden>
        {h.level === "good" ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        ) : h.level === "paused" ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round">
            <path d="M12 6v7" />
            <circle cx="12" cy="18" r="0.6" fill="currentColor" />
          </svg>
        )}
      </span>
      {h.label}
    </span>
  );
}

function ageLabel(iso: string) {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return { text: "now", late: false };
  if (hours < 24) return { text: `${Math.round(hours)} h`, late: false };
  const d = Math.floor(hours / 24);
  return { text: `${d} d`, late: hours >= 48 };
}

export default function AdminHome({ appName, adminName }: { appName: string; adminName?: string }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", client_name: "" });
  const [busy, setBusy] = useState(false);
  const [hello, setHello] = useState("");

  useEffect(() => {
    setHello(greeting());
    api<Dashboard>("/api/admin/dashboard")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { id } = await api<{ id: string }>("/api/admin/projects", { body: form });
      window.location.href = `/admin/projects/${id}?tab=knowledge`;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const t = data?.totals;
  const pct = t?.answerRate30 == null ? null : Math.round(t.answerRate30 * 100);
  const newButton = !creating && (
    <button className="btn btn-primary" onClick={() => setCreating(true)}>
      New project
    </button>
  );

  return (
    <>
      <AdminBar appName={appName} active="dashboard" />
      <main className="dash">
        <section className="dash-hero">
          <div className="grow">
            <div className="greet">
              {hello}
              {adminName ? `, ${adminName}` : ""}
            </div>
            <h1>
              {!t ? (
                <span className="soft">Loading your projects…</span>
              ) : t.openCount > 0 ? (
                <>
                  {t.openCount} question{t.openCount === 1 ? " needs" : "s need"} your answer.{" "}
                  {pct !== null && (
                    <span className="soft">
                      The assistant handled {pct}% of {t.questions30} client question{t.questions30 === 1 ? "" : "s"} this month.
                    </span>
                  )}
                </>
              ) : t.questions30 > 0 ? (
                <>
                  You&apos;re all caught up.{" "}
                  <span className="soft">
                    The assistant handled {pct}% of {t.questions30} client question{t.questions30 === 1 ? "" : "s"} this month.
                  </span>
                </>
              ) : (
                <>
                  All quiet so far. <span className="soft">Share a project&apos;s client link to get the first questions in.</span>
                </>
              )}
            </h1>
          </div>
          {newButton}
        </section>

        {error && <div className="notice error">{error}</div>}

        {creating && (
          <form className="card card-pad stack" onSubmit={create}>
            <h2>New project</h2>
            <div className="row wrap" style={{ alignItems: "flex-start" }}>
              <label className="field grow" style={{ minWidth: 220 }}>
                <span className="label">Project name</span>
                <input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Self Service Kiosk – Infrastructure" />
              </label>
              <label className="field grow" style={{ minWidth: 220 }}>
                <span className="label">Client</span>
                <input className="input" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} placeholder="e.g. Bank AL Habib" />
              </label>
            </div>
            <div className="row">
              <button className="btn btn-primary" disabled={!form.name.trim() || busy}>
                {busy && <span className="spinner" />} Create project
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {data && (
          <>
            <StatTiles t={data.totals} oldestOpen={data.needsYou[0]?.created_at} />

            <div className="dash-grid">
              <section className="card">
                <ActivityChart data={data.daily} title="Client questions" subtitle="Last 30 days, all projects" />
              </section>
              <section className="card">
                <div className="panel-head">
                  <div>
                    <h2>Needs you</h2>
                    <p>Oldest first</p>
                  </div>
                </div>
                {data.needsYou.length === 0 && !(data.reviews || []).length ? (
                  <div className="empty-state">
                    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--good)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <circle cx="12" cy="12" r="9.5" />
                      <path d="M7.5 12.5l3 3 6-6.5" />
                    </svg>
                    <p className="muted small">No questions waiting. New ones from clients will show up here.</p>
                  </div>
                ) : (
                  <div style={{ marginTop: 8 }}>
                    {(data.reviews || []).map((r) => (
                      <Link key={`r-${r.project_id}`} href={`/admin/projects/${r.project_id}?tab=tracker`} className="needs-item">
                        <div className="grow">
                          <div className="q">
                            {r.count} new action item{r.count === 1 ? "" : "s"} found in emails
                          </div>
                          <div className="tiny muted ellipsis" style={{ marginTop: 3 }}>
                            {r.project_name}, review and confirm
                          </div>
                        </div>
                        <span className="age">New</span>
                      </Link>
                    ))}
                    {data.needsYou.map((q) => {
                      const age = ageLabel(q.created_at);
                      return (
                        <Link key={q.id} href={`/admin/projects/${q.project_id}?q=${q.id}`} className="needs-item">
                          <div className="grow">
                            <div className="q">{q.question}</div>
                            <div className="tiny muted ellipsis" style={{ marginTop: 3 }}>
                              {q.project_name}
                              {q.visitor_email ? `, from ${q.visitor_email}` : ""}
                            </div>
                          </div>
                          <span className={`age${age.late ? " late" : ""}`} title={new Date(q.created_at).toLocaleString()}>
                            {age.text}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            <section className="stack" style={{ gap: 14 }}>
              <div className="section-head">
                <div className="grow">
                  <h2>Projects</h2>
                  <p className="small muted">Sorted by what needs attention first. Stats cover the last 30 days.</p>
                </div>
              </div>
              {data.projects.length === 0 ? (
                <div className="card empty-state">
                  <h2>Create your first project</h2>
                  <p className="muted" style={{ maxWidth: 520 }}>
                    Add the project&apos;s documents and email threads, then share its link with the client. The assistant answers from those
                    documents and sends you anything it can&apos;t.
                  </p>
                  {newButton}
                </div>
              ) : (
                <div className="health-grid">
                  {data.projects.map((p) => (
                    <Link key={p.id} href={`/admin/projects/${p.id}`} className={`card hcard ${p.health.level}`} style={p.active ? undefined : { opacity: 0.65 }}>
                      <div className="row" style={{ alignItems: "flex-start" }}>
                        <div className="grow" style={{ minWidth: 0 }}>
                          <h3 className="clamp2">{p.name}</h3>
                          <div className="small muted ellipsis">{p.client_name || "No client set"}</div>
                        </div>
                        <HealthBadge h={p.health} />
                      </div>
                      <div className="hreason">{p.health.reason}</div>
                      <div className="hstats">
                        <div className="hstat">
                          <div className="k">Answer rate</div>
                          <div className="v">{p.answer_rate === null ? "—" : `${Math.round(p.answer_rate * 100)}%`}</div>
                        </div>
                        <div className="hstat">
                          <div className="k">Waiting for you</div>
                          <div className="v">{p.open_count}</div>
                        </div>
                        <div className="hstat">
                          <div className="k">Pending from client</div>
                          <div className="v">{p.client_items ?? 0}</div>
                        </div>
                      </div>
                      <Meter value={p.answer_rate} />
                      <div className="hfoot">
                        <Sparkline values={p.spark} days={data.sparkDays} />
                        <span className="tiny muted nowrap">{p.last_activity ? `Active ${timeAgo(p.last_activity)}` : "No chats yet"}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}

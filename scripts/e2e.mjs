// End-to-end check against a running app (npm start) + scripts/mock-claude.mjs + a real Postgres.
const BASE = process.env.APP_URL_TEST || "http://localhost:3000";
const MOCK = "http://localhost:4599";
let cookie = "";
let failures = 0;

function ok(cond, msg) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
}

async function call(path, { method, body, headers = {}, auth = true } = {}) {
  const res = await fetch(BASE + path, {
    method: method || (body ? "POST" : "GET"),
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(auth && cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  let data = {};
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(500);
  }
  return null;
}

(async () => {
  ok((await call("/api/admin/dashboard", { auth: false })).status === 401, "admin API needs login");
  ok((await call("/api/auth/login", { body: { password: "wrong" } })).status === 401, "wrong password rejected");
  ok((await call("/api/auth/login", { body: { password: process.env.ADMIN_PASSWORD } })).status === 200, "login works");

  const a = await call("/api/admin/projects", { body: { name: "Kiosk Infra", client_name: "Test Bank" } });
  ok(a.status === 201, "create project");
  const pid = a.data.id;
  let p = (await call(`/api/admin/projects/${pid}`)).data;
  ok(Boolean(p.project?.inbound_key), "project has a forwarding key");
  ok(/\+[a-z0-9]+@/.test(p.inboundAddress || ""), `forwarding address shown (${p.inboundAddress})`);

  const doc = await call(`/api/admin/projects/${pid}/documents`, { body: { title: "HLD v1.3", kind: "document", content: "Phase 01 needs 3 servers: web, app and database." } });
  ok(doc.status === 201, "add a document");
  const mail = await call(`/api/admin/projects/${pid}/documents`, { body: { title: "Email – VPN", kind: "email", content: "From: vendor\nPlease share VPN access by 15 Jan." } });
  ok(mail.status === 201, "add an email");

  const items = await waitFor(async () => {
    const r = await call(`/api/admin/projects/${pid}/items`);
    return r.data.items?.length ? r.data.items : null;
  });
  ok(items && items[0].status === "suggested" && items[0].due_date === "2030-01-15", "action item extracted from email in the background");

  if (items) ok((await call(`/api/admin/items/${items[0].id}`, { method: "PATCH", body: { status: "open" } })).status === 200, "confirm item");
  const manual = await call(`/api/admin/projects/${pid}/items`, { body: { title: "Send server prerequisites", owner: "us", due_date: "2020-01-01" } });
  ok(manual.status === 201, "add item by hand");

  const slug = p.project.slug;
  const info = await call(`/api/chat/${slug}/info`, { auth: false });
  ok(info.data.items?.length === 2, "client sees confirmed items");

  const ans = await call(`/api/chat/${slug}`, { body: { message: "How many servers for phase 1?" }, auth: false });
  ok(ans.status === 200 && ans.data.message?.status === "answered", "bot answers from documents");
  const reqs = await (await fetch(`${MOCK}/__requests`)).json();
  const lastRespond = [...reqs].reverse().find((r) => (r.tools || []).some((t) => t.name === "respond"));
  const kb = JSON.stringify(lastRespond?.system || "");
  ok(kb.includes("Project tracker") && kb.includes("Share VPN access"), "tracker is part of the bot's knowledge");
  ok(lastRespond?.tool_choice?.type === "auto", "chat uses tool_choice auto");

  const esc = await call(`/api/chat/${slug}`, { body: { message: "What is the backup policy?", conversationId: ans.data.conversationId }, auth: false });
  ok(esc.data.message?.status === "escalated" && esc.data.needsEmail === true, "unknown question is escalated");

  p = (await call(`/api/admin/projects/${pid}`)).data;
  const q = p.questions.find((x) => x.status === "open");
  ok(Boolean(q?.suggested_reply), "suggested reply saved");
  const answered = await call(`/api/admin/questions/${q.id}`, {
    method: "PATCH",
    body: { action: "answer", reply: "Daily backups, kept for 30 days.", addToKb: true, sendEmail: false, shared: true },
  });
  ok(answered.status === 200 && answered.data.docId, "answer saved to knowledge base");

  const b = await call("/api/admin/projects", { body: { name: "Second Project", client_name: "Other Bank" } });
  const p2 = (await call(`/api/admin/projects/${b.data.id}`)).data;
  ok(p2.sharedDocs?.some((d) => d.title.startsWith("Q&A")), "shared answer appears in other projects");
  await call(`/api/chat/${p2.project.slug}`, { body: { message: "How long are backups kept?" }, auth: false });
  const reqs2 = await (await fetch(`${MOCK}/__requests`)).json();
  const last2 = [...reqs2].reverse().find((r) => (r.tools || []).some((t) => t.name === "respond"));
  ok(JSON.stringify(last2?.system || "").includes("kept for 30 days"), "other project's bot uses shared knowledge");
  ok(!JSON.stringify(last2?.system || "").includes("3 servers"), "other project's bot does NOT see project-specific docs");

  const gen = await call(`/api/admin/projects/${pid}/generate`, { body: { kind: "faq", instructions: "" } });
  ok(gen.status === 201 && gen.data.id, "generate FAQ");
  const g = await call(`/api/admin/generated/${gen.data.id}`);
  ok(g.data.document?.title === "Kiosk – Frequently asked questions", "generated title taken from heading");
  ok((await call(`/api/chat/${slug}/docs/${gen.data.id}`, { auth: false })).status === 404, "unpublished doc hidden from client");
  await call(`/api/admin/generated/${gen.data.id}`, { method: "PATCH", body: { published: true } });
  const pub = await call(`/api/chat/${slug}/docs/${gen.data.id}`, { auth: false });
  ok(pub.status === 200 && pub.data.document?.content.includes("self-service"), "published doc visible to client");

  const key = p.project.inbound_key;
  const inbound = (from, secret = process.env.INBOUND_SECRET) =>
    call(`/api/inbound/email?secret=${secret}`, {
      auth: false,
      body: {
        From: from,
        FromFull: { Email: from },
        MailboxHash: key,
        Subject: "Fwd: Firewall ports",
        TextBody: "Please open ports 443 and 8447 by 15 Jan.",
        Attachments: [{ Name: "ports.txt", ContentType: "text/plain", Content: Buffer.from("Port list: 443, 8447").toString("base64") }],
      },
    });
  ok((await inbound(process.env.ADMIN_EMAIL, "wrong-secret-123")).status === 401, "inbound rejects wrong secret");
  const bad = await inbound("stranger@example.com");
  ok(bad.status === 200 && bad.data.ignored === "sender not allowed", "inbound ignores unknown senders");
  const good = await inbound(process.env.ADMIN_EMAIL);
  ok(good.status === 200 && good.data.documentId && good.data.attachments === 1, "forwarded email + attachment added");
  p = (await call(`/api/admin/projects/${pid}`)).data;
  ok(p.documents.some((d) => d.title === "Fwd: Firewall ports") && p.documents.some((d) => d.title === "ports"), "forwarded email visible in knowledge base");

  const dash = await call("/api/admin/dashboard");
  ok(dash.status === 200 && dash.data.projects?.length === 2 && dash.data.totals?.questions30 >= 3, "dashboard loads with stats");
  const kp = dash.data.projects?.find((x) => x.id === pid);
  ok(kp?.client_items === 1, "dashboard counts items pending from client");
  ok(kp?.health?.level === "warning", `health flags overdue item (${kp?.health?.reason})`);
  const st = await call(`/api/admin/projects/${pid}/stats`);
  ok(st.status === 200 && st.data.daily?.length === 30, "project stats load");

  for (const path of ["/login", `/p/${slug}`, "/admin"]) {
    const r = await fetch(BASE + path, { headers: { cookie }, redirect: "manual" });
    ok(r.status === 200, `page ${path} renders`);
  }

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

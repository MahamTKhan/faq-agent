# FAQ Agent

A private knowledge-base assistant for client projects.

- **You (admin)** create a project, add its documents (PDF, Word, Outlook emails, text) and email threads, and share one link with the client.
- **The client** asks questions in a simple chat. The assistant answers only from that project's documents and shows which document it used.
- **If the answer isn't in the documents**, the client is told the question has gone to the team. You get an email with the question and a **suggested reply**. You edit it in the dashboard and send it. The answer is emailed to the client, shows up in their chat, and is saved to the knowledge base, so next time the assistant can answer it itself.

Every project has its own link (and optional access code). Only you can log in to the dashboard and see all projects.

---

## Deploy it (about 15 minutes)

You need four things: this GitHub repo, a Vercel account, a Claude API key and an email login for sending alerts.

### 1. Create the Vercel project

1. Go to [vercel.com](https://vercel.com) → **Add New… → Project** → import **FAQ-Agent** from GitHub.
2. Don't deploy yet. First open **Environment Variables** (step 3).

### 2. Add a database

The easiest route is Vercel's built-in option: in your Vercel project, open **Storage → Create Database → Neon (Postgres)** and connect it to the project. It adds `DATABASE_URL` for you.

Or use [Supabase](https://supabase.com) (free): **New project → Connect → Transaction pooler**. Copy the URI, put your database password in it, and use it as `DATABASE_URL`.

The tables are created automatically on first use. There's nothing to run.

### 3. Environment variables

| Name | What to put |
| --- | --- |
| `DATABASE_URL` | Set by Neon automatically, or your Supabase pooler URI |
| `ADMIN_PASSWORD` | The password you'll use to log in |
| `SESSION_SECRET` | Any random 32+ characters, e.g. a long password from your password manager |
| `ANTHROPIC_API_KEY` | From [console.anthropic.com](https://console.anthropic.com) → API Keys (add some credit under Billing) |
| `ADMIN_EMAIL` | Where new-question alerts go |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Email sending details, see below |
| `APP_NAME` *(optional)* | Name shown in the app and emails, default "Project Desk" |

**Email sending options**

- **Gmail:** `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=you@gmail.com`, `SMTP_PASS=` an [App Password](https://myaccount.google.com/apppasswords) (needs 2-Step Verification on), `MAIL_FROM=Project Desk <you@gmail.com>`.
- **Outlook / Microsoft 365:** `SMTP_HOST=smtp.office365.com`, `SMTP_PORT=587`, plus your work login. Many companies switch SMTP off, so ask IT if this doesn't work.
- **Resend** (best for sending from a company domain): `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465`, `SMTP_USER=resend`, `SMTP_PASS=` your Resend API key, and a verified domain in `MAIL_FROM`.

The app works without email. You won't get alerts, but questions still collect in the dashboard.

### 4. Deploy

Click **Deploy**. When it's done, open `https://<your-app>.vercel.app/admin` and log in with `ADMIN_PASSWORD`.

If you change an environment variable later, go to **Deployments → ⋯ → Redeploy** so the change takes effect.

---

## Using it

1. **New project** → name it and add the client.
2. **Knowledge base** → drop in the HLD, SDD and other documents. PDFs are read page by page, including diagrams, so this takes a minute. Paste important email threads with **Paste an email thread or notes**. Open any source to check or correct the extracted text.
3. **Settings** → set an **access code**, a welcome message and a few **suggested questions** (shown as buttons to the client).
4. **Copy** the client link (plus the access code) and send it to the client.
5. When a question comes in that the documents don't cover, you get an email. Open **Questions**, edit the suggested reply (the assistant marks anything it had to guess with `[CONFIRM: …]`), and send it.

## Good to know

- **Everything in a project's knowledge base can be quoted to whoever has its link.** Don't add internal notes, or pricing and other details the client shouldn't see.
- Before putting bank documents on a cloud service, check with your security team and the client. Some banks need data kept in a specific region or on-premises.
- Vercel's free Hobby plan is for personal, non-commercial use. For company use, check whether you need Vercel Pro.
- Uploads are limited to about 4 MB per file (PDFs can be bigger, because they're split in your browser). For bigger files, paste the text.
- Small knowledge bases are sent to the model in full for the best answers. Large ones (over ~400k characters, tunable with `MAX_CONTEXT_CHARS`) are keyword-searched first.

## Running locally

```bash
cp .env.example .env.local   # fill it in
npm install
npm run dev                  # http://localhost:3000/admin
```

## How it's built

Next.js 15 (App Router) · Postgres (`postgres` driver, full-text search for large knowledge bases) · Claude Messages API (plain `fetch`, prompt caching, PDF reading) · Nodemailer (any SMTP) · pdf-lib (splits PDFs in the browser).

```
app/p/[slug]          client chat page
app/admin             dashboard (password-protected by middleware.ts)
app/api/chat/[slug]   answers questions, escalates the rest, emails you
app/api/admin/...     projects, documents, PDF reading, questions, conversations
lib/                  db + schema, Claude client and prompt, knowledge-base search, email, file extraction
```

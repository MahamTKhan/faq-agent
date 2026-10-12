import { db } from "@/lib/db";
import { handle, HttpError, json, requireAdmin } from "@/lib/http";
import { buildPortfolioReport } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Past reports, newest first. */
export const GET = handle(async (req: Request) => {
  await requireAdmin(req);
  const sql = await db();
  const reports = await sql`
    SELECT id, period_start, period_end, created_at, data->>'title' AS title FROM portfolio_reports
    ORDER BY created_at DESC LIMIT 20`;
  return json({ reports });
});

/** Writes a new weekly report for all projects. */
export const POST = handle(async (req: Request) => {
  await requireAdmin(req);
  if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(500, "ANTHROPIC_API_KEY is not set.");
  const sql = await db();
  let report;
  try {
    report = await buildPortfolioReport(sql);
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "Couldn't write the report.");
  }
  const [row] = await sql`
    INSERT INTO portfolio_reports (period_start, period_end, data)
    VALUES (${report.period.start}, ${report.period.end}, ${sql.json(report as never)})
    RETURNING id`;
  return json({ id: row.id, report }, 201);
});

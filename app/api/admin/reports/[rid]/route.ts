import { db } from "@/lib/db";
import { handle, HttpError, isUuid, json, requireAdmin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ rid: string }> };

export const GET = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const { rid } = await ctx.params;
  if (!isUuid(rid)) throw new HttpError(404, "Report not found.");
  const sql = await db();
  const [row] = await sql`SELECT id, data FROM portfolio_reports WHERE id = ${rid}`;
  if (!row) throw new HttpError(404, "Report not found.");
  return json({ id: row.id, report: row.data });
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const { rid } = await ctx.params;
  if (!isUuid(rid)) throw new HttpError(404, "Report not found.");
  const sql = await db();
  await sql`DELETE FROM portfolio_reports WHERE id = ${rid}`;
  return json({ ok: true });
});

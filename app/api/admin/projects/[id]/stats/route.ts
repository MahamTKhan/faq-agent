import { db } from "@/lib/db";
import { handle, HttpError, isUuid, json, requireAdmin } from "@/lib/http";
import { getDaily, getTotals } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new HttpError(404, "Project not found.");
  const sql = await db();
  const [totals, daily, recentEscalations] = await Promise.all([
    getTotals(sql, id),
    getDaily(sql, id),
    sql`SELECT id, question, status, created_at FROM questions WHERE project_id = ${id} ORDER BY created_at DESC LIMIT 6`,
  ]);
  return json({ totals, daily, recentEscalations });
});

import { db } from "@/lib/db";
import { handle, json, requireAdmin } from "@/lib/http";
import { getDashboard } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  await requireAdmin(req);
  const sql = await db();
  return json(await getDashboard(sql));
});

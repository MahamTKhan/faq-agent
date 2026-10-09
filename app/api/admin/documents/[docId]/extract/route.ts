import { db } from "@/lib/db";
import { handle, HttpError, isUuid, json, requireAdmin } from "@/lib/http";
import { extractActionItems } from "@/lib/tracker";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ docId: string }> };

/** "Find action items" on any source, on demand. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const { docId } = await ctx.params;
  if (!isUuid(docId)) throw new HttpError(404, "Document not found.");
  if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(500, "ANTHROPIC_API_KEY is not set.");
  const sql = await db();
  return json(await extractActionItems(sql, docId));
});

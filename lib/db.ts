import postgres from "postgres";
import { SCHEMA_SQL } from "./schema";

type Sql = ReturnType<typeof postgres>;

declare global {
  // eslint-disable-next-line no-var
  var __faqSql: Sql | undefined;
  // eslint-disable-next-line no-var
  var __faqSchema: Promise<void> | undefined;
}

function connect(): Sql {
  if (!globalThis.__faqSql) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Add it in your Vercel project settings.");
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || url.includes("host=/");
    globalThis.__faqSql = postgres(url, {
      // prepare:false keeps us compatible with Supabase / PgBouncer transaction pooling.
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 15,
      ssl: local ? false : "require",
      onnotice: () => {},
    });
  }
  return globalThis.__faqSql;
}

/** Returns a ready-to-use SQL client; creates the tables the first time. */
export async function db(): Promise<Sql> {
  const sql = connect();
  if (!globalThis.__faqSchema) {
    globalThis.__faqSchema = sql
      .unsafe(SCHEMA_SQL)
      .then(() => undefined)
      .catch((e) => {
        globalThis.__faqSchema = undefined;
        throw e;
      });
  }
  await globalThis.__faqSchema;
  return sql;
}

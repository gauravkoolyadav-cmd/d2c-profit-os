import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// `next build` imports route modules to collect page data; no DB connection is made then
// (pg connects lazily on the first query), so only require DATABASE_URL at runtime.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

if (!process.env.DATABASE_URL && !isBuildPhase) {
  throw new Error("DATABASE_URL is not set");
}

// Standard PostgreSQL driver (works with Supabase Postgres).
// Reuse one pool across Next.js dev hot reloads so connections are not exhausted.
const globalForDb = globalThis as unknown as { pgPool?: Pool };

const pool =
  globalForDb.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") globalForDb.pgPool = pool;

export const db = drizzle(pool, { schema });
export * from "./schema";

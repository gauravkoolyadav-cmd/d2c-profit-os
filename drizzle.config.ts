import { config } from "dotenv";
import type { Config } from "drizzle-kit";

// drizzle-kit does not load Next.js env files, so load them here.
// .env.local wins; .env is a fallback (dotenv never overrides already-set vars).
config({ path: [".env.local", ".env"], quiet: true });

export default {
  schema: "./src/lib/db/schema",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;

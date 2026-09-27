import { getTableName } from "drizzle-orm";
/**
 * Chainable fake for the Drizzle `db` object.
 *
 * - Every property access / call is recorded in `dbCalls` with a dotted path
 *   (e.g. "query.brands.findFirst", "insert.values", "select.from.where").
 * - Awaiting any chain resolves to an override registered for that path, or a
 *   sensible default. No real database is ever contacted.
 */
export interface DbCall {
  path: string;
  args: unknown[];
  /** Table name passed to insert()/update()/delete()/from(), when known. */
  table?: string;
}

export const dbCalls: DbCall[] = [];
const overrides = new Map<string, unknown>();

export const FAKE_CONNECTION = {
  id: "c0000000-0000-4000-8000-000000000001",
  platform: "shopify",
  accountId: "demo.myshopify.com",
  accessToken: "shpat_SECRET_ACCESS_TOKEN",
  refreshToken: "SECRET_REFRESH_TOKEN",
  tokenExpiresAt: null,
  scopes: "read_orders",
  metadata: {
    myshopifyDomain: "demo.myshopify.com",
    webhookSecret: "SECRET_WEBHOOK",
    clientSecret: "SECRET_CLIENT",
    developerToken: "SECRET_DEV_TOKEN",
    appSecret: "SECRET_APP",
    testCode: "SECRET_TEST_CODE",
    clientId: "client-id",
    pixelId: "123456",
  },
  status: "active",
  lastSyncedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

function defaults(): Map<string, unknown> {
  return new Map<string, unknown>([
    ["query.brands.findFirst", { id: "brand", name: "Brand", slug: "brand", timezone: "Asia/Kolkata", currency: "INR" }],
    ["query.platformConnections.findFirst", { ...FAKE_CONNECTION, brandId: "brand" }],
  ]);
}

export function resetFakeDb(): void {
  dbCalls.length = 0;
  overrides.clear();
  for (const [key, value] of defaults()) overrides.set(key, value);
}

export function setDbResult(path: string, value: unknown): void {
  overrides.set(path, value);
}

/** Override for a chain that touched a specific table, e.g. "select.from.where@orders". */
export function setDbResultForTable(path: string, table: string, value: unknown): void {
  overrides.set(`${path}@${table}`, value);
}

function tableNameOf(value: unknown): string | undefined {
  if (value && typeof value === "object") {
    try {
      return getTableName(value as never) || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function resolveFor(path: string, table?: string): unknown {
  if (table && overrides.has(`${path}@${table}`)) return overrides.get(`${path}@${table}`);
  if (overrides.has(path)) return overrides.get(path);
  if (path.endsWith("findFirst")) return undefined;
  if (path.endsWith("returning")) return [{ id: "00000000-0000-4000-8000-0000000000ff" }];
  return [];
}

function makeNode(path: string, table?: string): unknown {
  const target = function () {};
  return new Proxy(target, {
    get(_t, prop) {
      if (typeof prop === "symbol") return undefined;
      if (prop === "then") {
        const value = resolveFor(path, table);
        return (resolve: (v: unknown) => unknown) => resolve(value);
      }
      return makeNode(path ? `${path}.${prop}` : prop, table);
    },
    apply(_t, _this, args: unknown[]) {
      const last = path.split(".").pop();
      const argTable = ["insert", "update", "delete", "from"].includes(last ?? "") ? tableNameOf(args[0]) : undefined;
      const nextTable = table ?? argTable;
      dbCalls.push({ path, args, table: nextTable });
      return makeNode(path, nextTable);
    },
  });
}

export const fakeDb = makeNode("");

resetFakeDb();

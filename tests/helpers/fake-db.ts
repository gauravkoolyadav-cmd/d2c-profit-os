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

function resolveFor(path: string): unknown {
  if (overrides.has(path)) return overrides.get(path);
  if (path.endsWith("findFirst")) return undefined;
  if (path.endsWith("returning")) return [{ id: "00000000-0000-4000-8000-0000000000ff" }];
  return [];
}

function makeNode(path: string): unknown {
  const target = function () {};
  return new Proxy(target, {
    get(_t, prop) {
      if (typeof prop === "symbol") return undefined;
      if (prop === "then") {
        const value = resolveFor(path);
        return (resolve: (v: unknown) => unknown) => resolve(value);
      }
      return makeNode(path ? `${path}.${prop}` : prop);
    },
    apply(_t, _this, args: unknown[]) {
      dbCalls.push({ path, args });
      return makeNode(path);
    },
  });
}

export const fakeDb = makeNode("");

resetFakeDb();

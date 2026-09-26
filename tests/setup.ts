/**
 * Global test setup: isolates every test from the network and database.
 *
 * vi.mock calls in a setup file apply to all test files.
 */
import { beforeEach, vi } from "vitest";
import { resetFakeDb } from "./helpers/fake-db";
import { EXISTING_BRANDS, MEMBERSHIPS } from "./helpers/world";

// ── Database: chainable fake, real schema definitions ─────────────────────
vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema");
  const { fakeDb } = await import("./helpers/fake-db");
  return { ...schema, db: fakeDb };
});

// ── Auth.js session: controlled per test via setSession() ─────────────────
vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(async () => null),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: { GET: vi.fn(), POST: vi.fn() },
}));

// ── Brand membership: in-memory multi-tenant world ────────────────────────
vi.mock("@/lib/auth/membership", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/membership")>(
    "@/lib/auth/membership"
  );
  const { MEMBERSHIPS: members, EXISTING_BRANDS: brands } = await import("./helpers/world");
  return {
    ...actual,
    getBrandMembership: vi.fn(async (userId: string, brandId: string) => {
      if (!brands.has(brandId)) return null;
      const role = members[brandId]?.[userId];
      return role ? { brandId, role } : null;
    }),
    brandExists: vi.fn(async (brandId: string) => brands.has(brandId)),
  };
});

// ── Service layer (data access beyond authorization) ──────────────────────
vi.mock("@/lib/profit/calculations", () => ({
  calculateProfitMetrics: vi.fn(async () => ({ revenue: 0, orders: 0 })),
  getDailyProfitData: vi.fn(async () => []),
  getWeeklyProfitData: vi.fn(async () => []),
  getMonthlyProfitData: vi.fn(async () => []),
  getPlatformProfitBreakdown: vi.fn(async () => ({})),
}));

vi.mock("@/lib/dashboard/overview", () => ({
  getDashboardOverview: vi.fn(async () => ({ connections: {}, quickStats: {}, topCampaigns: [], recentActivity: [] })),
  getMultiBrandComparison: vi.fn(async (brandIds: string[]) =>
    brandIds.map((brandId) => ({ brandId, brandName: `Brand ${brandId}`, metrics: { revenue: 1 } }))
  ),
}));

vi.mock("@/lib/ai/analysis", () => ({
  generateAnomalyAnalysis: vi.fn(async () => []),
  generateInsights: vi.fn(async () => []),
  generateRecommendations: vi.fn(async () => []),
  generateTrendAnalysis: vi.fn(async () => []),
}));

vi.mock("@/lib/attribution/tracking", () => ({
  getBrandAttribution: vi.fn(async () => ({ byPlatform: [], byCampaign: [] })),
  trackPixelEvent: vi.fn(async () => undefined),
}));

vi.mock("@/lib/payments/management", () => ({
  getBrandSubscription: vi.fn(async () => null),
  getBrandInvoices: vi.fn(async () => []),
  createSubscriptionCheckout: vi.fn(async () => ({ checkoutUrl: "https://checkout.test", subscriptionId: "sub" })),
  cancelSubscription: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/payments/polar", async () => {
  const actual = await vi.importActual<typeof import("@/lib/payments/polar")>("@/lib/payments/polar");
  return {
    ...actual,
    cancelPolarSubscription: vi.fn(async () => ({ id: "polar-sub" })),
    getPolarInvoice: vi.fn(async () => null),
    getPolarSubscription: vi.fn(async () => null),
    createPolarCheckout: vi.fn(async () => null),
  };
});

vi.mock("@/lib/telegram/notifications", () => ({
  sendTestNotification: vi.fn(async () => true),
}));

vi.mock("@/lib/telegram/client", () => ({
  sendMessage: vi.fn(async () => ({ ok: true })),
  getBotInfo: vi.fn(async () => ({ ok: true, result: { id: 1, username: "bot", first_name: "Bot" } })),
}));

vi.mock("@/lib/capi/meta", () => {
  const ok = vi.fn(async () => ({ success: true, eventId: "evt" }));
  return {
    sendMetaEvent: ok,
    sendPurchaseEvent: vi.fn(async () => ({ success: true, eventId: "evt" })),
    sendInitiateCheckoutEvent: vi.fn(async () => ({ success: true, eventId: "evt" })),
    sendAddToCartEvent: vi.fn(async () => ({ success: true, eventId: "evt" })),
    sendViewContentEvent: vi.fn(async () => ({ success: true, eventId: "evt" })),
    sendLeadEvent: vi.fn(async () => ({ success: true, eventId: "evt" })),
    sendSearchEvent: vi.fn(async () => ({ success: true, eventId: "evt" })),
  };
});

vi.mock("@/lib/platforms/ads/sync", () => ({
  syncAdData: vi.fn(async () => ({ campaigns: 0, adSets: 0, ads: 0, snapshots: 0, errors: 0 })),
  logSync: vi.fn(async () => "log-id"),
}));

vi.mock("@/lib/platforms/shopify", () => ({
  ShopifyClient: vi.fn().mockImplementation(() => ({ getShop: vi.fn(async () => ({ id: 1 })) })),
  syncShopifyProducts: vi.fn(async () => ({ created: 0, updated: 0, errors: 0 })),
  syncShopifyOrders: vi.fn(async () => ({ created: 0, updated: 0, errors: 0 })),
}));

vi.mock("@/lib/platforms/meta/client", () => ({
  MetaClient: vi.fn().mockImplementation(() => ({
    getAdAccounts: vi.fn(async () => [{ account_id: "123", account_status: 1, name: "Acct" }]),
  })),
}));

vi.mock("@/lib/platforms/google/client", () => ({
  GoogleAdsClient: vi.fn().mockImplementation(() => ({ getCampaigns: vi.fn(async () => []) })),
}));

vi.mock("@/lib/platforms/snapchat/client", () => ({
  SnapchatClient: vi.fn().mockImplementation(() => ({ getCampaigns: vi.fn(async () => []) })),
}));

vi.mock("@/lib/platforms/tiktok/client", () => ({
  TikTokClient: vi.fn().mockImplementation(() => ({
    getAdAccounts: vi.fn(async () => [{ advertiser_id: "1" }]),
  })),
}));

// Keep expected error logging out of the test output.
vi.spyOn(console, "error").mockImplementation(() => {});

// Touch imports so the world is loaded before tests run.
void EXISTING_BRANDS;
void MEMBERSHIPS;

beforeEach(() => {
  resetFakeDb();
});

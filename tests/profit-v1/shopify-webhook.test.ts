import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";
import { shopifyOrderPayload } from "./shopify-order";
import { BRAND_A, BRAND_B } from "../helpers/world";

vi.mock("@/lib/profit-v1/repository", () => ({
  DEFAULT_SETTINGS: { timezone: "Asia/Kolkata" },
  findShopifyConnectionsByShop: vi.fn(),
  recordWebhookReceipt: vi.fn(),
  markWebhookReceipt: vi.fn(),
  markShopifyUninstalled: vi.fn(),
  getProfitSettings: vi.fn(async () => ({ timezone: "Asia/Kolkata", defaultProductGstPercent: 0 })),
  upsertOrder: vi.fn(async () => ({ orderId: "o1", action: "inserted" })),
}));

import * as repo from "@/lib/profit-v1/repository";
import { POST } from "@/app/api/webhooks/shopify/route";

const SECRET = "shpss_test_secret";
const SHOP = "gmsolo.myshopify.com";

function webhook(body: Record<string, unknown>, opts: { topic?: string; secret?: string; hmac?: string; webhookId?: string; shop?: string } = {}) {
  const raw = JSON.stringify(body);
  const hmac = opts.hmac ?? createHmac("sha256", opts.secret ?? SECRET).update(raw, "utf8").digest("base64");
  return POST(
    new Request("http://localhost/api/webhooks/shopify", {
      method: "POST",
      body: raw,
      headers: {
        "content-type": "application/json",
        "x-shopify-hmac-sha256": hmac,
        "x-shopify-topic": opts.topic ?? "orders/create",
        "x-shopify-shop-domain": opts.shop ?? SHOP,
        "x-shopify-webhook-id": opts.webhookId ?? "wh-1",
      },
    })
  );
}

beforeEach(() => {
  vi.stubEnv("SHOPIFY_WEBHOOK_SECRET", SECRET);
  vi.mocked(repo.findShopifyConnectionsByShop).mockResolvedValue([{ brandId: BRAND_A, status: "active", metadata: {} }]);
  vi.mocked(repo.recordWebhookReceipt).mockResolvedValue({ id: "receipt-1", previousStatus: null });
});

describe("POST /api/webhooks/shopify: order ingestion", () => {
  it("stores a valid order under the brand that owns the shop", async () => {
    const response = await webhook(shopifyOrderPayload());
    expect(response.status).toBe(200);
    expect(repo.upsertOrder).toHaveBeenCalledTimes(1);
    const [brandId, shop, parsed] = vi.mocked(repo.upsertOrder).mock.calls[0];
    expect(brandId).toBe(BRAND_A);
    expect(shop).toBe(SHOP);
    expect(parsed).toMatchObject({
      shopifyOrderId: "5550001111",
      paymentType: "PREPAID",
      attribution: expect.objectContaining({ metaAdId: "120000000000001" }),
      items: [expect.objectContaining({ productTitle: "Nepolian Clog", quantity: 1 })],
    });
    expect(repo.markWebhookReceipt).toHaveBeenCalledWith("receipt-1", "processed");
  });

  it("rejects an invalid signature without storing anything", async () => {
    const response = await webhook(shopifyOrderPayload(), { secret: "wrong-secret" });
    expect(response.status).toBe(401);
    expect(repo.recordWebhookReceipt).not.toHaveBeenCalled();
    expect(repo.upsertOrder).not.toHaveBeenCalled();
  });

  it("rejects a malformed/short signature without crashing", async () => {
    const response = await webhook(shopifyOrderPayload(), { hmac: "abc" });
    expect(response.status).toBe(401);
  });

  it("fails closed when no webhook secret is configured", async () => {
    vi.stubEnv("SHOPIFY_WEBHOOK_SECRET", "");
    const response = await webhook(shopifyOrderPayload());
    expect(response.status).toBe(503);
    expect(repo.upsertOrder).not.toHaveBeenCalled();
  });

  it("uses the per-store webhook secret when the connection has one", async () => {
    vi.stubEnv("SHOPIFY_WEBHOOK_SECRET", "");
    vi.mocked(repo.findShopifyConnectionsByShop).mockResolvedValue([
      { brandId: BRAND_A, status: "active", metadata: { webhookSecret: "store-secret" } },
    ]);
    expect((await webhook(shopifyOrderPayload(), { secret: "store-secret" })).status).toBe(200);
  });

  it("a repeated delivery (same webhook id) is acknowledged but not processed twice", async () => {
    vi.mocked(repo.recordWebhookReceipt).mockResolvedValue({ id: "receipt-1", previousStatus: "processed" });
    const response = await webhook(shopifyOrderPayload());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ duplicate: true });
    expect(repo.upsertOrder).not.toHaveBeenCalled();
  });

  it("a previously FAILED delivery is processed again on retry", async () => {
    vi.mocked(repo.recordWebhookReceipt).mockResolvedValue({ id: "receipt-1", previousStatus: "failed" });
    expect((await webhook(shopifyOrderPayload())).status).toBe(200);
    expect(repo.upsertOrder).toHaveBeenCalledTimes(1);
  });

  it("an order update arrives as orders/updated and goes through the same upsert", async () => {
    await webhook(shopifyOrderPayload({ tags: "RTO" }), { topic: "orders/updated", webhookId: "wh-2" });
    expect(vi.mocked(repo.upsertOrder).mock.calls[0][2]).toMatchObject({ orderStatus: "RTO" });
  });

  it("a cancelled order is stored with status CANCELLED", async () => {
    await webhook(shopifyOrderPayload({ cancelled_at: "2026-09-26T10:00:00Z" }), { topic: "orders/cancelled" });
    expect(vi.mocked(repo.upsertOrder).mock.calls[0][2]).toMatchObject({ orderStatus: "CANCELLED" });
  });

  it("unknown shops are ignored (never attached to some other brand)", async () => {
    vi.mocked(repo.findShopifyConnectionsByShop).mockResolvedValue([]);
    const response = await webhook(shopifyOrderPayload(), { shop: "stranger.myshopify.com" });
    expect(response.status).toBe(200);
    expect(repo.upsertOrder).not.toHaveBeenCalled();
  });

  it("a shop linked to two brands is refused (cross-brand isolation)", async () => {
    vi.mocked(repo.findShopifyConnectionsByShop).mockResolvedValue([
      { brandId: BRAND_A, status: "active", metadata: {} },
      { brandId: BRAND_B, status: "active", metadata: {} },
    ]);
    const response = await webhook(shopifyOrderPayload());
    expect(response.status).toBe(409);
    expect(repo.upsertOrder).not.toHaveBeenCalled();
  });

  it("processing errors mark the receipt failed and return 500 so Shopify retries", async () => {
    vi.mocked(repo.upsertOrder).mockRejectedValueOnce(new Error("db down"));
    const response = await webhook(shopifyOrderPayload());
    expect(response.status).toBe(500);
    expect(repo.markWebhookReceipt).toHaveBeenCalledWith("receipt-1", "failed", "db down");
  });
});

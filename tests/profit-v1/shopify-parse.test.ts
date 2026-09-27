import { describe, expect, it } from "vitest";
import { classifyPaymentType, deriveOrderStatus, parseShopifyOrder, ShopifyPayloadError } from "@/lib/profit-v1/shopify-parse";
import { shopifyOrderPayload } from "./shopify-order";

describe("Shopify order ingestion: parsing", () => {
  const parsed = parseShopifyOrder(shopifyOrderPayload(), "Asia/Kolkata");

  it("captures the order fields needed for profit", () => {
    expect(parsed).toMatchObject({
      shopifyOrderId: "5550001111",
      orderNumber: "1001",
      orderName: "#1001",
      orderDate: "2026-09-26", // business date in IST, not UTC
      paymentType: "PREPAID",
      orderStatus: "PENDING",
      financialStatus: "paid",
      totalPrice: 1499,
    });
    expect(parsed.items).toEqual([
      expect.objectContaining({
        shopifyLineItemId: "9990001",
        productTitle: "Nepolian Clog",
        variantTitle: "Black / 8",
        quantity: 1,
        unitPrice: 1499,
      }),
    ]);
  });

  it("captures UTM and Meta IDs from the landing site", () => {
    expect(parsed.attribution).toMatchObject({
      utmSource: "facebook",
      utmMedium: "paid",
      utmCampaign: "120000000000100",
      utmContent: "120000000000001",
      metaCampaignId: "120000000000100",
      metaAdId: "120000000000001",
    });
    expect(parsed.attributionRaw).toMatchObject({ fbclid_present: true, referring_site: "https://l.facebook.com/" });
  });

  it("note attributes (checkout apps) take priority over the landing site", () => {
    const p = parseShopifyOrder(
      shopifyOrderPayload({
        note_attributes: [
          { name: "utm_campaign", value: "Clog Broad" },
          { name: "utm_content", value: "Video 01" },
        ],
      }),
      "Asia/Kolkata"
    );
    expect(p.attribution.utmCampaign).toBe("Clog Broad");
    expect(p.attribution.utmContent).toBe("Video 01");
  });

  it("keeps the raw payload for debugging but strips customer personal data", () => {
    const raw = parsed.rawPayload;
    expect(raw).not.toHaveProperty("email");
    expect(raw).not.toHaveProperty("phone");
    expect(raw).not.toHaveProperty("customer");
    expect(raw).not.toHaveProperty("billing_address");
    expect(raw.shipping_address).toEqual({ city: "Agra", province: "Uttar Pradesh", zip: "282007", country_code: "IN" });
    expect(raw.line_items).toBeDefined();
  });

  it("rejects payloads without an id", () => {
    expect(() => parseShopifyOrder({ created_at: "2026-09-26T00:00:00Z" }, "Asia/Kolkata")).toThrow(ShopifyPayloadError);
  });
});

describe("payment type", () => {
  it.each([
    [{ financial_status: "paid", payment_gateway_names: ["razorpay"] }, "PREPAID"],
    [{ financial_status: "pending", payment_gateway_names: ["Cash on Delivery (COD)"] }, "COD"],
    [{ financial_status: "paid", payment_gateway_names: ["Cash on Delivery (COD)"] }, "COD"], // COD later marked paid
    [{ financial_status: "partially_paid", payment_gateway_names: ["gokwik", "Cash on Delivery (COD)"] }, "PARTIAL_COD"],
    [{ financial_status: "pending", tags: "Partial COD", payment_gateway_names: [] }, "PARTIAL_COD"],
    [{ financial_status: "pending", payment_gateway_names: ["bank transfer"] }, "UNKNOWN"],
  ])("%j → %s", (payload, expected) => {
    expect(classifyPaymentType(payload)).toBe(expected);
  });
});

describe("order status", () => {
  it.each([
    [{ cancelled_at: "2026-09-26T10:00:00Z" }, "CANCELLED"],
    [{ tags: "RTO, courier-delhivery" }, "RTO"],
    [{ fulfillments: [{ shipment_status: "delivered" }] }, "DELIVERED"],
    [{ fulfillments: [{ shipment_status: "in_transit" }] }, "PENDING"],
    [{}, "PENDING"],
  ])("%j → %s", (payload, expected) => {
    expect(deriveOrderStatus(payload)).toBe(expected);
  });
});

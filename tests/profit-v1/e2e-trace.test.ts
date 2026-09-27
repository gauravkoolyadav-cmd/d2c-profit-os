/**
 * End-to-end V1 trace: one Shopify order from Meta ad click to dashboard numbers.
 *
 *   Meta ad (fbclid + UTM) → Shopify webhook payload → parseShopifyOrder → upsertOrder (DB row)
 *   → loadOrdersForRange mapping → shoe mapping → payment type → attribution (campaign + creative)
 *   → Google Sheet config → profit engine → dashboard report.
 *
 * Each `it` is labelled with the verification item number (V1–V15).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { parseShopifyOrder, type ParsedOrder } from "@/lib/profit-v1/shopify-parse";
import { parseConfigSheet } from "@/lib/profit-v1/sheet-parse";
import { buildProfitReport, createProfitContext, calculateOrderProfit } from "@/lib/profit-v1/engine";
import { RANGE_PRESETS, resolveRange } from "@/lib/profit-v1/dates";
import { upsertOrder } from "@/lib/profit-v1/repository";
import type { EngineOrder, ShoeConfig } from "@/lib/profit-v1/types";
import { dbCalls, resetFakeDb, setDbResultForTable } from "../helpers/fake-db";
import { AD_ID, AD_ID_2, CAMPAIGN_ID, CAMPAIGNS, CREATIVES, spend } from "./fixtures";
import { shopifyOrderPayload } from "./shopify-order";

const TZ = "Asia/Kolkata";
const DAY = { from: "2026-09-26", to: "2026-09-26" };

// The Google Sheet, exactly as the sheet sync reads it.
const HEADER = ["Shoe Name", "Prepaid SP", "COD/Partial SP", "Product Cost", "Prepaid Shipping", "COD Shipping", "Prepaid Delivery %", "COD/Partial Delivery %"];
const SHEET = [
  HEADER,
  ["Nepolian Clog", "1499", "1399", "350", "80", "105", "95%", "85%"],
  ["Zenwalkers Signature Shoes", "1499", "1299", "320", "80", "105", "96%", "84%"],
];
function sheetConfigs(sheet: string[][] = SHEET): ShoeConfig[] {
  const parsed = parseConfigSheet(sheet);
  expect(parsed.errors).toEqual([]);
  return parsed.configs;
}

/** Same mapping as repository.loadOrdersForRange (DB row → EngineOrder). */
function toEngineOrder(parsed: ParsedOrder, id = "order-1"): EngineOrder {
  return {
    id,
    orderNumber: parsed.orderName ?? parsed.orderNumber,
    orderDate: parsed.orderDate,
    createdAt: parsed.shopifyCreatedAt.toISOString(),
    paymentType: parsed.paymentType,
    orderStatus: parsed.orderStatus,
    totalPrice: parsed.totalPrice,
    items: parsed.items.map((i) => ({
      productTitle: i.productTitle,
      variantTitle: i.variantTitle,
      lineName: i.lineName,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    })),
    attribution: parsed.attribution,
  };
}

function ctxFor(configs = sheetConfigs()) {
  return createProfitContext({ configs, mappings: [], creatives: CREATIVES, campaigns: CAMPAIGNS, defaultGstPercent: 0 });
}

// The traced order: clicked a Meta ad in campaign "Zenwalkers Scale", bought a Nepolian Clog, prepaid.
const LANDING = `/products/nepolian-clog?utm_source=facebook&utm_medium=paid&utm_campaign=${CAMPAIGN_ID}&utm_content=${AD_ID}&fbclid=IwAR0trace123`;
const traced = parseShopifyOrder(shopifyOrderPayload({ landing_site: LANDING }), TZ);

const PREPAID_PROFIT = 1499 * 0.95 - 350 * 0.95 - 80; // 1011.55
const COD_PROFIT = 1399 * 0.85 - 350 * 0.85 - 105; //     786.65

describe("E2E trace: Meta ad → Shopify → DB → engine → dashboard", () => {
  beforeEach(() => resetFakeDb());

  it("V1 fbclid is captured and preserved (value, not just a flag)", () => {
    expect(traced.attributionRaw.fbclid).toBe("IwAR0trace123");
    expect(traced.attributionRaw.fbclid_present).toBe(true);
    expect(traced.landingSite).toContain("fbclid=IwAR0trace123");
  });

  it("V2 utm_campaign and utm_content are preserved", () => {
    expect(traced.attribution.utmCampaign).toBe(CAMPAIGN_ID);
    expect(traced.attribution.utmContent).toBe(AD_ID);
    expect(traced.attribution.utmSource).toBe("facebook");
  });

  it("V3 + V4 the order is connected to the Meta campaign AND the creative", () => {
    const profit = calculateOrderProfit(toEngineOrder(traced), ctxFor());
    expect(profit.attribution.campaignId).toBe(CAMPAIGN_ID);
    expect(profit.attribution.campaignName).toBe("Zenwalkers Scale");
    expect(profit.attribution.creativeId).toBe(AD_ID);
    expect(profit.attribution.creativeName).toBe("Video Hook 03");
    expect(profit.attribution.matchedToMeta).toBe(true);
  });

  it("V4 campaign id + ad NAME in utm_content still resolves the creative", () => {
    const parsed = parseShopifyOrder(
      shopifyOrderPayload({ landing_site: `/p?utm_campaign=${CAMPAIGN_ID}&utm_content=Video%20Hook%2003&fbclid=x` }),
      TZ
    );
    const profit = calculateOrderProfit(toEngineOrder(parsed), ctxFor());
    expect(profit.attribution.campaignId).toBe(CAMPAIGN_ID);
    expect(profit.attribution.creativeId).toBe(AD_ID);
  });

  it("V5 + V6 the shoe comes from the Shopify line item and maps to the sheet row (not from the campaign)", () => {
    // Campaign is "Zenwalkers Scale", but the customer bought a Nepolian Clog.
    const profit = calculateOrderProfit(toEngineOrder(traced), ctxFor());
    expect(profit.lines).toHaveLength(1);
    expect(profit.lines[0].productTitle).toBe("Nepolian Clog");
    expect(profit.lines[0].shoeName).toBe("Nepolian Clog");
    expect(profit.lines[0].shoeName).not.toBe("Zenwalkers Signature Shoes");
  });

  it("V7 PREPAID uses prepaid SP, prepaid shipping and prepaid delivery %", () => {
    expect(traced.paymentType).toBe("PREPAID");
    const p = calculateOrderProfit(toEngineOrder(traced), ctxFor());
    expect(p.lines[0].sellingPrice).toBe(1499);
    expect(p.lines[0].deliveryPercent).toBe(95);
    expect(p.shippingCost).toBe(80);
    expect(p.profit).toBeCloseTo(PREPAID_PROFIT, 2);
  });

  it("V8 COD uses COD/Partial SP, COD shipping and COD/Partial delivery %", () => {
    const parsed = parseShopifyOrder(
      shopifyOrderPayload({ landing_site: LANDING, financial_status: "pending", payment_gateway_names: ["Cash on Delivery (COD)"] }),
      TZ
    );
    expect(parsed.paymentType).toBe("COD");
    const p = calculateOrderProfit(toEngineOrder(parsed), ctxFor());
    expect(p.lines[0].sellingPrice).toBe(1399);
    expect(p.lines[0].deliveryPercent).toBe(85);
    expect(p.shippingCost).toBe(105);
    expect(p.profit).toBeCloseTo(COD_PROFIT, 2);
  });

  it("V9 PARTIAL_COD uses the COD/Partial config", () => {
    const parsed = parseShopifyOrder(
      shopifyOrderPayload({ landing_site: LANDING, financial_status: "partially_paid", payment_gateway_names: ["razorpay", "Cash on Delivery (COD)"] }),
      TZ
    );
    expect(parsed.paymentType).toBe("PARTIAL_COD");
    const p = calculateOrderProfit(toEngineOrder(parsed), ctxFor());
    expect(p.lines[0].sellingPrice).toBe(1399);
    expect(p.lines[0].deliveryPercent).toBe(85);
    expect(p.shippingCost).toBe(105);
    expect(p.profit).toBeCloseTo(COD_PROFIT, 2);
  });

  it("V9 a stored COD order upgrades to PARTIAL_COD on a later webhook (other types stay sticky)", async () => {
    const partial = parseShopifyOrder(
      shopifyOrderPayload({ financial_status: "partially_paid", updated_at: "2026-09-25T21:00:00+00:00" }),
      TZ
    );
    const storedAs = async (existing: string) => {
      resetFakeDb();
      setDbResultForTable("select.from.where.limit", "orders", [
        { id: "o1", paymentType: existing, shopifyUpdatedAt: new Date("2026-09-25T20:16:00Z") },
      ]);
      await upsertOrder("brand-a", "shop.myshopify.com", partial);
      const insert = dbCalls.find((c) => c.path === "insert.values" && c.table === "orders")!;
      return (insert.args[0] as { paymentType: string }).paymentType;
    };
    expect(await storedAs("COD")).toBe("PARTIAL_COD");
    expect(await storedAs("PREPAID")).toBe("PREPAID");
  });

  it("V10 shipping is charged exactly once per order, including RTO and multi-shoe orders", () => {
    const rto = parseShopifyOrder(shopifyOrderPayload({ landing_site: LANDING, tags: "RTO" }), TZ);
    expect(rto.orderStatus).toBe("RTO");
    const rtoProfit = calculateOrderProfit(toEngineOrder(rto), ctxFor());
    expect(rtoProfit.shippingCost).toBe(80);

    const multi = parseShopifyOrder(
      shopifyOrderPayload({
        line_items: [
          { id: 1, title: "Nepolian Clog", variant_title: "8", quantity: 2, price: "1499.00" },
          { id: 2, title: "Zenwalkers Signature Shoes", variant_title: "9", quantity: 1, price: "1499.00" },
        ],
      }),
      TZ
    );
    const report = buildProfitReport(ctxFor(), [toEngineOrder(rto, "rto"), toEngineOrder(multi, "multi")], [], DAY);
    expect(report.totals.shippingCost).toBe(160); // 80 + 80, never 80×3 or a second RTO charge
  });

  it("V11 Meta spend is charged × 1.18", () => {
    const report = buildProfitReport(ctxFor(), [toEngineOrder(traced)], [spend(DAY.from, AD_ID, 1000)], DAY);
    expect(report.totals.metaSpend).toBe(1000);
    expect(report.totals.metaCost).toBe(1180);
    const creative = report.creatives.find((c) => c.creativeId === AD_ID)!;
    expect(creative.profit).toBeCloseTo(PREPAID_PROFIT - 1180, 2);
  });

  it("V12 unattributed orders stay in their own row", () => {
    const organic = parseShopifyOrder(shopifyOrderPayload({ id: 2, landing_site: "/products/nepolian-clog", referring_site: null }), TZ);
    const report = buildProfitReport(
      ctxFor(),
      [toEngineOrder(traced, "paid"), toEngineOrder(organic, "organic")],
      [spend(DAY.from, AD_ID, 1000), spend(DAY.from, AD_ID_2, 500)],
      DAY
    );
    const unattributed = report.campaigns.find((c) => c.key === "UNATTRIBUTED")!;
    expect(unattributed.orders).toBe(1);
    expect(unattributed.metaCost).toBe(0);
    expect(report.campaigns.find((c) => c.campaignId === CAMPAIGN_ID)!.orders).toBe(1);
  });

  it("V13 changing the Google Sheet config changes profit", () => {
    const before = calculateOrderProfit(toEngineOrder(traced), ctxFor()).profit;
    const edited = SHEET.map((row) => (row[0] === "Nepolian Clog" ? ["Nepolian Clog", "1599", "1399", "350", "90", "105", "90%", "85%"] : row));
    const after = calculateOrderProfit(toEngineOrder(traced), ctxFor(sheetConfigs(edited))).profit;
    expect(before).toBeCloseTo(PREPAID_PROFIT, 2);
    expect(after).toBeCloseTo(1599 * 0.9 - 350 * 0.9 - 90, 2);
  });

  it("V14 dashboard ranges: Today / 7 / 15 / 30 / Custom", () => {
    expect(RANGE_PRESETS).toEqual(expect.arrayContaining(["today", "7d", "15d", "30d"]));
    const now = new Date("2026-09-26T06:00:00Z");
    expect(resolveRange({ range: "today" }, TZ, now)).toMatchObject({ ok: true, range: DAY });
    expect(resolveRange({ range: "custom", from: "2026-09-01", to: "2026-09-26" }, TZ, now)).toMatchObject({
      ok: true,
      range: { from: "2026-09-01", to: "2026-09-26" },
    });
  });

  it("V15 the order is written and looked up only inside its own brand", async () => {
    await upsertOrder("brand-a", "shop.myshopify.com", traced);
    const insert = dbCalls.find((c) => c.path === "insert.values" && c.table === "orders")!;
    expect((insert.args[0] as { brandId: string }).brandId).toBe("brand-a");
    const items = dbCalls.find((c) => c.path === "insert.values" && c.table === "order_items")!;
    for (const item of items.args[0] as { brandId: string }[]) expect(item.brandId).toBe("brand-a");
  });
});

import { describe, expect, it } from "vitest";
import { buildProfitReport, createProfitContext, summarizeRange } from "@/lib/profit-v1/engine";
import { presetRange, resolveRange } from "@/lib/profit-v1/dates";
import { AD_ID, AD_ID_2, CAMPAIGN_ID, CAMPAIGNS, CONFIGS, CREATIVES, order, spend } from "./fixtures";

const ctx = createProfitContext({ configs: CONFIGS, mappings: [], creatives: CREATIVES, campaigns: CAMPAIGNS, defaultGstPercent: 0 });
const PREPAID_PROFIT = 1499 * 0.95 - 350 * 0.95 - 80; // 1011.55
const COD_PROFIT = 1399 * 0.85 - 350 * 0.85 - 105; //     786.65
const DAY = { from: "2026-09-26", to: "2026-09-26" };

describe("campaign and creative profit", () => {
  const orders = [
    order({ attribution: { metaAdId: AD_ID } }), // Video Hook 03
    order({ paymentType: "COD", attribution: { utmContent: AD_ID } }), // Video Hook 03
    order({ attribution: { metaCampaignId: CAMPAIGN_ID } }), // campaign only
    order({}), // unattributed
  ];
  const spendRows = [spend("2026-09-26", AD_ID, 1000), spend("2026-09-26", AD_ID_2, 500)];
  const report = buildProfitReport(ctx, orders, spendRows, DAY);

  it("creative profit = its attributed orders' profit − its spend × 1.18", () => {
    const creative = report.creatives.find((c) => c.creativeId === AD_ID)!;
    expect(creative.orders).toBe(2);
    expect(creative.metaSpend).toBe(1000);
    expect(creative.metaGst).toBe(180);
    expect(creative.metaCost).toBe(1180);
    expect(creative.profit).toBeCloseTo(PREPAID_PROFIT + COD_PROFIT - 1180, 2);
  });

  it("a creative with spend but no orders shows a loss", () => {
    const creative = report.creatives.find((c) => c.creativeId === AD_ID_2)!;
    expect(creative.orders).toBe(0);
    expect(creative.profit).toBeCloseTo(-590, 2);
  });

  it("campaign profit aggregates all its creatives and campaign-only orders", () => {
    const campaign = report.campaigns.find((c) => c.campaignId === CAMPAIGN_ID)!;
    expect(campaign.orders).toBe(3);
    expect(campaign.metaSpend).toBe(1500);
    expect(campaign.metaCost).toBe(1770);
    expect(campaign.totalCost).toBeCloseTo(campaign.productCost + campaign.shippingCost + 1770, 2);
    expect(campaign.profit).toBeCloseTo(2 * PREPAID_PROFIT + COD_PROFIT - 1770, 2);
  });

  it("unattributed orders stay in their own row and are not spread across campaigns", () => {
    const unattributed = report.campaigns.find((c) => c.key === "UNATTRIBUTED")!;
    expect(unattributed.orders).toBe(1);
    expect(unattributed.metaCost).toBe(0);
    expect(unattributed.profit).toBeCloseTo(PREPAID_PROFIT, 2);
    const attributedOrders = report.campaigns.filter((c) => c.key !== "UNATTRIBUTED").reduce((s, c) => s + c.orders, 0);
    expect(attributedOrders).toBe(3);
  });

  it("total profit = all orders' profit − ALL Meta cost", () => {
    expect(report.totals.orders).toBe(4);
    expect(report.totals.metaCost).toBe(1770);
    expect(report.totals.profit).toBeCloseTo(3 * PREPAID_PROFIT + COD_PROFIT - 1770, 2);
    expect(report.health.attribution.unattributed).toBe(1);
    expect(report.health.attribution.campaignOnly).toBe(1);
  });

  it("shoe table: Meta cost of a creative is split over the shoes of its attributed orders", () => {
    const nepolian = report.shoes.find((s) => s.shoeName === "Nepolian Clog")!;
    expect(nepolian.orders).toBe(4);
    expect(nepolian.metaCost).toBeCloseTo(1180, 2); // Video Hook 03's orders are all Nepolian
    expect(report.unallocatedAdSpend.metaCost).toBeCloseTo(590, 2); // Static 01 had no orders
  });
});

describe("date ranges use one reusable engine", () => {
  const NOW = new Date("2026-09-26T10:00:00+05:30");
  const TZ = "Asia/Kolkata";
  const on = (date: string) => order({ orderDate: date });
  const orders = [
    on("2026-09-26"), // today
    on("2026-09-25"), // yesterday
    on("2026-09-20"), // day 7
    on("2026-09-19"), // day 8
    on("2026-09-12"), // day 15
    on("2026-08-28"), // day 30
    on("2026-08-27"), // day 31
  ];
  const spendRows = [spend("2026-09-26", AD_ID, 100), spend("2026-09-19", AD_ID, 100), spend("2026-08-27", AD_ID, 100)];

  it("presets resolve in the brand timezone (today includes today)", () => {
    expect(presetRange("today", TZ, NOW)).toEqual({ from: "2026-09-26", to: "2026-09-26" });
    expect(presetRange("yesterday", TZ, NOW)).toEqual({ from: "2026-09-25", to: "2026-09-25" });
    expect(presetRange("7d", TZ, NOW)).toEqual({ from: "2026-09-20", to: "2026-09-26" });
    expect(presetRange("15d", TZ, NOW)).toEqual({ from: "2026-09-12", to: "2026-09-26" });
    expect(presetRange("30d", TZ, NOW)).toEqual({ from: "2026-08-28", to: "2026-09-26" });
  });

  it("uses the business timezone for 'today' (00:30 IST is still today in India)", () => {
    expect(presetRange("today", TZ, new Date("2026-09-25T19:30:00Z"))).toEqual({ from: "2026-09-26", to: "2026-09-26" });
  });

  it("daily profit", () => {
    const t = summarizeRange(ctx, orders, spendRows, presetRange("today", TZ, NOW));
    expect(t.orders).toBe(1);
    expect(t.metaCost).toBe(118);
    expect(t.profit).toBeCloseTo(PREPAID_PROFIT - 118, 2);
  });

  it("7-day profit", () => {
    const t = summarizeRange(ctx, orders, spendRows, presetRange("7d", TZ, NOW));
    expect(t.orders).toBe(3);
    expect(t.profit).toBeCloseTo(3 * PREPAID_PROFIT - 118, 2);
  });

  it("15-day profit", () => {
    const t = summarizeRange(ctx, orders, spendRows, presetRange("15d", TZ, NOW));
    expect(t.orders).toBe(5);
    expect(t.profit).toBeCloseTo(5 * PREPAID_PROFIT - 236, 2);
  });

  it("30-day profit", () => {
    const t = summarizeRange(ctx, orders, spendRows, presetRange("30d", TZ, NOW));
    expect(t.orders).toBe(6);
    expect(t.profit).toBeCloseTo(6 * PREPAID_PROFIT - 236, 2);
  });

  it("custom date range (01/09 → 26/09)", () => {
    const resolved = resolveRange({ range: "custom", from: "2026-09-01", to: "2026-09-26" }, TZ, NOW);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const report = buildProfitReport(ctx, orders, spendRows, resolved.range);
    expect(report.totals.orders).toBe(5);
    expect(report.daily).toHaveLength(26);
    expect(report.totals.profit).toBeCloseTo(5 * PREPAID_PROFIT - 236, 2);
  });

  it("rejects invalid custom ranges", () => {
    expect(resolveRange({ range: "custom", from: "2026-09-26", to: "2026-09-01" }, TZ, NOW).ok).toBe(false);
    expect(resolveRange({ range: "custom", from: "2026-02-30", to: "2026-03-01" }, TZ, NOW).ok).toBe(false);
    expect(resolveRange({ range: "custom", from: "2024-01-01", to: "2026-01-01" }, TZ, NOW).ok).toBe(false);
    expect(resolveRange({ range: "90d" }, TZ, NOW).ok).toBe(false);
  });
});

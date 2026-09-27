import { describe, expect, it, vi } from "vitest";
import { BRAND_A, BRAND_B } from "../helpers/world";
import { CONFIGS, order } from "./fixtures";

vi.mock("@/lib/profit-v1/repository", () => ({
  getProfitSettings: vi.fn(async () => ({ timezone: "Asia/Kolkata", defaultProductGstPercent: 0, googleSheetId: "sheet", configRange: "Config!A1:Z1000", mappingRange: null })),
  loadOrdersForRange: vi.fn(async () => [order({ orderDate: "2026-09-26" })]),
  loadSpendForRange: vi.fn(async () => []),
  loadShoeConfigs: vi.fn(async () => CONFIGS),
  loadNameMappings: vi.fn(async () => []),
  loadMetaEntities: vi.fn(async () => ({ creatives: [], campaigns: [] })),
  latestConfigSyncRun: vi.fn(async () => null),
  latestPlatformSyncs: vi.fn(async () => []),
  webhookHealth: vi.fn(async () => ({ lastReceivedAt: null, failedLast7Days: 0, lastError: null })),
}));

import * as repo from "@/lib/profit-v1/repository";
import { getProfitDashboard } from "@/lib/profit-v1/service";

describe("dashboard service: cross-brand isolation", () => {
  it("every data load is scoped to the requested brand only", async () => {
    await getProfitDashboard(BRAND_A, { range: "today" }, new Date("2026-09-26T10:00:00+05:30"));
    const loaders = [
      repo.getProfitSettings,
      repo.loadOrdersForRange,
      repo.loadSpendForRange,
      repo.loadShoeConfigs,
      repo.loadNameMappings,
      repo.loadMetaEntities,
      repo.latestConfigSyncRun,
      repo.latestPlatformSyncs,
      repo.webhookHealth,
    ];
    for (const loader of loaders) {
      const calls = vi.mocked(loader).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      for (const args of calls) {
        expect(args[0]).toBe(BRAND_A);
        expect(JSON.stringify(args)).not.toContain(BRAND_B);
      }
    }
  });

  it("returns today, 7, 15 and 30-day totals plus the selected range", async () => {
    const dashboard = await getProfitDashboard(BRAND_A, { range: "30d" }, new Date("2026-09-26T10:00:00+05:30"));
    expect(dashboard.periods.today.orders).toBe(1);
    expect(dashboard.periods.last30Days.orders).toBe(1);
    expect(dashboard.report.range).toEqual({ from: "2026-08-28", to: "2026-09-26" });
    expect(dashboard.report.totals.profit).toBeCloseTo(1499 * 0.95 - 350 * 0.95 - 80, 2);
  });

  it("loads data far enough back for a custom range and for the 30-day strip", async () => {
    await getProfitDashboard(BRAND_A, { range: "custom", from: "2026-07-01", to: "2026-07-31" }, new Date("2026-09-26T10:00:00+05:30"));
    expect(vi.mocked(repo.loadOrdersForRange)).toHaveBeenCalledWith(BRAND_A, "2026-07-01", "2026-09-26");
  });
});

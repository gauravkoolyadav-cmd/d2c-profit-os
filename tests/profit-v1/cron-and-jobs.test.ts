import { beforeEach, describe, expect, it, vi } from "vitest";
import { BRAND_A } from "../helpers/world";

vi.mock("@/lib/integrations/google-sheets", () => ({ readSheetValues: vi.fn() }));
vi.mock("@/lib/profit-v1/repository", () => ({
  getProfitSettings: vi.fn(async () => ({ timezone: "Asia/Kolkata", googleSheetId: "sheet123456789", configRange: "Config!A1:Z1000", mappingRange: null, defaultProductGstPercent: 0 })),
  startConfigSyncRun: vi.fn(async () => "run-1"),
  finishConfigSyncRun: vi.fn(async () => undefined),
  applyShoeConfig: vi.fn(async () => undefined),
  brandIdsWithSheet: vi.fn(async () => [BRAND_A]),
  brandIdsWithActiveConnection: vi.fn(async () => []),
}));

import { readSheetValues } from "@/lib/integrations/google-sheets";
import * as repo from "@/lib/profit-v1/repository";
import { syncSheetForBrand as mockedSheetJob } from "@/lib/profit-v1/jobs";
import { GET as cron } from "@/app/api/cron/profit-sync/route";

const jobs = await vi.importActual<typeof import("@/lib/profit-v1/jobs")>("@/lib/profit-v1/jobs");
const HEADER = ["Shoe Name", "Prepaid SP", "COD/Partial SP", "Product Cost", "Prepaid Shipping", "COD Shipping", "Prepaid Delivery %", "COD/Partial Delivery %"];

describe("Google Sheet sync job", () => {
  it("valid rows are applied; invalid rows are rejected and reported", async () => {
    vi.mocked(readSheetValues).mockResolvedValue([
      HEADER,
      ["Nepolian Clog", "1499", "1399", "350", "80", "105", "95%", "85%"],
      ["Broken Shoe", "1499", "1399", "350", "80", "105", "150%", "85%"],
    ]);
    const result = await jobs.syncSheetForBrand(BRAND_A, "manual");
    expect(result.ok).toBe(true);
    const applied = vi.mocked(repo.applyShoeConfig).mock.calls[0];
    expect(applied[0]).toBe(BRAND_A);
    expect(applied[1].configs.map((c) => c.shoeName)).toEqual(["Nepolian Clog"]);
    expect(vi.mocked(repo.finishConfigSyncRun).mock.calls[0][2]).toMatchObject({ status: "partial", rowsApplied: 1, rowsRejected: 1 });
  });

  it("an empty or broken sheet never wipes the existing configuration", async () => {
    vi.mocked(readSheetValues).mockResolvedValue([HEADER, ["", "", "", "", "", "", "", ""], ["Bad", "-1", "1", "1", "1", "1", "95", "85"]]);
    const result = await jobs.syncSheetForBrand(BRAND_A, "cron");
    expect(result.ok).toBe(false);
    expect(repo.applyShoeConfig).not.toHaveBeenCalled();
  });

  it("Meta purchases are read from the purchase action", () => {
    expect(jobs.purchasesFromActions([{ action_type: "link_click", value: "40" }, { action_type: "purchase", value: "3" }])).toBe(3);
    expect(jobs.purchasesFromActions(undefined)).toBe(0);
  });
});

describe("GET /api/cron/profit-sync", () => {
  beforeEach(() => vi.stubEnv("CRON_SECRET", "cron-secret"));
  const call = (auth?: string, job = "sheet") =>
    cron(new Request(`http://localhost/api/cron/profit-sync?job=${job}`, { headers: auth ? { authorization: auth } : {} }));

  it("fails closed without CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer cron-secret")).status).toBe(503);
  });

  it("rejects a wrong or missing secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(mockedSheetJob).not.toHaveBeenCalled();
  });

  it("runs the sheet sync for every brand that has a sheet", async () => {
    const response = await call("Bearer cron-secret");
    expect(response.status).toBe(200);
    expect(mockedSheetJob).toHaveBeenCalledWith(BRAND_A, "cron");
  });
});

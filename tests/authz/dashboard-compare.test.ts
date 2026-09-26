import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/dashboard/compare/route";
import { getMultiBrandComparison } from "@/lib/dashboard/overview";
import { setSession, setSessionUser } from "../helpers/session";
import { BRAND_A, BRAND_B, BRAND_MISSING, USERS } from "../helpers/world";
import { calledServices } from "../helpers/services";

function compare(ids: string[] | string) {
  const value = Array.isArray(ids) ? ids.join(",") : ids;
  return GET(new NextRequest(`http://localhost/api/dashboard/compare?brandIds=${encodeURIComponent(value)}`));
}

describe("GET /api/dashboard/compare", () => {
  it("rejects unauthenticated users", async () => {
    setSession(null);
    const response = await compare([BRAND_A, BRAND_B]);
    expect(response.status).toBe(401);
    expect(calledServices()).toEqual([]);
  });

  it("REGRESSION: owner of Brand A cannot pull Brand B metrics by adding it to the list", async () => {
    setSessionUser(USERS.ownerA);
    const response = await compare([BRAND_A, BRAND_B]);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ error: "One or more brands were not found" });
    expect(JSON.stringify(body)).not.toContain(BRAND_B);
    expect(getMultiBrandComparison).not.toHaveBeenCalled();
  });

  it("REGRESSION: a non-member cannot compare two brands they do not belong to", async () => {
    setSessionUser(USERS.outsider);
    const response = await compare([BRAND_A, BRAND_B]);
    expect(response.status).toBe(404);
    expect(getMultiBrandComparison).not.toHaveBeenCalled();
  });

  it("rejects non-existent brands the same way", async () => {
    setSessionUser(USERS.ownerAandB);
    const response = await compare([BRAND_A, BRAND_MISSING]);
    expect(response.status).toBe(404);
    expect(getMultiBrandComparison).not.toHaveBeenCalled();
  });

  it("allows a user who is a member of every requested brand", async () => {
    setSessionUser(USERS.ownerAandB);
    const response = await compare([BRAND_A, BRAND_B]);
    expect(response.status).toBe(200);
    expect(getMultiBrandComparison).toHaveBeenCalledTimes(1);
    expect(getMultiBrandComparison).toHaveBeenCalledWith([BRAND_A, BRAND_B], expect.any(Object));
    const body = await response.json();
    expect(body.comparisons.map((c: { brandId: string }) => c.brandId)).toEqual([BRAND_A, BRAND_B]);
  });

  it("deduplicates ids, so one brand repeated is not a comparison", async () => {
    setSessionUser(USERS.ownerA);
    const response = await compare([BRAND_A, BRAND_A]);
    expect(response.status).toBe(400);
    expect(getMultiBrandComparison).not.toHaveBeenCalled();
  });

  it("rejects malformed ids and oversized lists", async () => {
    setSessionUser(USERS.ownerAandB);
    expect((await compare([BRAND_A, "not-a-uuid"])).status).toBe(400);
    const many = Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect((await compare(many)).status).toBe(400);
    expect(getMultiBrandComparison).not.toHaveBeenCalled();
  });
});

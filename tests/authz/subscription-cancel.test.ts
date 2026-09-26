import { describe, expect, it, vi } from "vitest";
import { DELETE } from "@/app/api/brands/[id]/billing/subscription/route";
import { cancelSubscription } from "@/lib/payments/management";
import { cancelPolarSubscription } from "@/lib/payments/polar";
import { NextRequest } from "next/server";
import { setSession, setSessionUser } from "../helpers/session";
import { BRAND_A, BRAND_B, SUBSCRIPTION_A, SUBSCRIPTION_B, USERS, PERSONAS } from "../helpers/world";
import { dbCalls, setDbResult } from "../helpers/fake-db";

function cancel(brandId: string, subscriptionId: unknown) {
  const request = new NextRequest(`http://localhost/api/brands/${brandId}/billing/subscription`, {
    method: "DELETE",
    body: JSON.stringify({ subscriptionId }),
    headers: { "content-type": "application/json" },
  });
  return DELETE(request, { params: Promise.resolve({ id: brandId }) });
}

describe("DELETE /api/brands/[id]/billing/subscription (route)", () => {
  it.each(PERSONAS.filter((p) => p.key !== "owner"))(
    "$label cannot cancel Brand A's subscription",
    async (persona) => {
      setSession(persona);
      const response = await cancel(BRAND_A, SUBSCRIPTION_A);
      expect([401, 403, 404]).toContain(response.status);
      expect(cancelSubscription).not.toHaveBeenCalled();
    }
  );

  it("REGRESSION: owner of Brand B cannot cancel Brand A's subscription via Brand A's URL", async () => {
    setSessionUser(USERS.ownerB);
    const response = await cancel(BRAND_A, SUBSCRIPTION_A);
    expect(response.status).toBe(404);
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it("REGRESSION: owner of Brand A cannot cancel Brand B's subscription via their own URL", async () => {
    setSessionUser(USERS.ownerA);
    vi.mocked(cancelSubscription).mockResolvedValueOnce({ ok: false, reason: "not_found" });

    const response = await cancel(BRAND_A, SUBSCRIPTION_B);

    expect(response.status).toBe(404);
    // The service is always asked to cancel within the AUTHORIZED brand only.
    expect(cancelSubscription).toHaveBeenCalledWith(SUBSCRIPTION_B, BRAND_A);
  });

  it("owner of Brand A can cancel Brand A's subscription", async () => {
    setSessionUser(USERS.ownerA);
    const response = await cancel(BRAND_A, SUBSCRIPTION_A);
    expect(response.status).toBe(200);
    expect(cancelSubscription).toHaveBeenCalledWith(SUBSCRIPTION_A, BRAND_A);
  });

  it("rejects malformed subscription ids without calling the service", async () => {
    setSessionUser(USERS.ownerA);
    expect((await cancel(BRAND_A, "../../other")).status).toBe(404);
    expect((await cancel(BRAND_A, undefined)).status).toBe(400);
    expect(cancelSubscription).not.toHaveBeenCalled();
  });
});

describe("cancelSubscription (real implementation)", () => {
  const actual = () =>
    vi.importActual<typeof import("@/lib/payments/management")>("@/lib/payments/management");

  it("REGRESSION: refuses a subscription that belongs to another brand, even if the query returns it", async () => {
    const { cancelSubscription: realCancel } = await actual();
    // Simulate a lookup returning Brand B's subscription (defense in depth).
    setDbResult("query.subscriptions.findFirst", {
      id: SUBSCRIPTION_B,
      brandId: BRAND_B,
      polarSubscriptionId: "polar_b",
    });

    const result = await realCancel(SUBSCRIPTION_B, BRAND_A);

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(cancelPolarSubscription).not.toHaveBeenCalled();
    expect(dbCalls.some((c) => c.path.startsWith("update"))).toBe(false);
  });

  it("returns not_found when no subscription matches id + brand", async () => {
    const { cancelSubscription: realCancel } = await actual();
    setDbResult("query.subscriptions.findFirst", undefined);
    expect(await realCancel(SUBSCRIPTION_A, BRAND_A)).toEqual({ ok: false, reason: "not_found" });
    expect(cancelPolarSubscription).not.toHaveBeenCalled();
  });

  it("cancels the brand's own subscription with Polar and locally", async () => {
    const { cancelSubscription: realCancel } = await actual();
    setDbResult("query.subscriptions.findFirst", {
      id: SUBSCRIPTION_A,
      brandId: BRAND_A,
      polarSubscriptionId: "polar_a",
    });

    expect(await realCancel(SUBSCRIPTION_A, BRAND_A)).toEqual({ ok: true });
    expect(cancelPolarSubscription).toHaveBeenCalledWith("polar_a", true);
    expect(dbCalls.some((c) => c.path === "update.set.where")).toBe(true);
  });

  it("reports provider_error and does not update locally when Polar fails", async () => {
    const { cancelSubscription: realCancel } = await actual();
    setDbResult("query.subscriptions.findFirst", {
      id: SUBSCRIPTION_A,
      brandId: BRAND_A,
      polarSubscriptionId: "polar_a",
    });
    vi.mocked(cancelPolarSubscription).mockResolvedValueOnce(null);

    expect(await realCancel(SUBSCRIPTION_A, BRAND_A)).toEqual({ ok: false, reason: "provider_error" });
    expect(dbCalls.some((c) => c.path.startsWith("update"))).toBe(false);
  });
});

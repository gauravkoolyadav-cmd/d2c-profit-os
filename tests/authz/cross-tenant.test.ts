/**
 * Cross-tenant regression suite.
 *
 * The owner of Brand B (a fully privileged user in their own tenant) must not
 * be able to read or modify ANY of Brand A's data, and must not even learn
 * whether Brand A exists.
 */
import { describe, expect, it } from "vitest";
import { BRAND_ROUTES, callRoute, type DataCategory } from "../helpers/routes";
import { setSession, setSessionUser } from "../helpers/session";
import { ATTACKER_OWNER_B, BRAND_A, BRAND_B, USERS } from "../helpers/world";
import { dbCalls } from "../helpers/fake-db";
import { calledServices, serviceCallsMentioning } from "../helpers/services";

const REQUIRED_CATEGORIES: DataCategory[] = [
  "dashboard/profit",
  "orders",
  "campaigns",
  "products",
  "integrations",
  "settings",
];

describe("user from Brand B cannot access Brand A", () => {
  for (const category of REQUIRED_CATEGORIES) {
    const routes = BRAND_ROUTES.filter((r) => r.categories.includes(category));

    describe(category, () => {
      it("has at least one route under test", () => {
        expect(routes.length).toBeGreaterThan(0);
      });

      it.each(routes)("$name → 404, no data access", async (route) => {
        setSession(ATTACKER_OWNER_B);

        const response = await callRoute(route, BRAND_A);

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "Brand not found" });
        expect(dbCalls).toHaveLength(0);
        expect(calledServices()).toEqual([]);
      });
    });
  }

  it("gets the same response for Brand A as for a brand that does not exist", async () => {
    setSession(ATTACKER_OWNER_B);
    const route = BRAND_ROUTES.find((r) => r.name === "GET profit")!;
    const real = await callRoute(route, BRAND_A);
    const missing = await callRoute(route, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect(real.status).toBe(missing.status);
    expect(await real.json()).toEqual(await missing.json());
  });

  it("still works normally inside their own brand (sanity check)", async () => {
    setSession(ATTACKER_OWNER_B);
    const route = BRAND_ROUTES.find((r) => r.name === "GET profit")!;
    const response = await callRoute(route, BRAND_B);
    expect(response.status).toBe(200);
    expect(serviceCallsMentioning(BRAND_B)).toContain("profit.getDailyProfitData");
    expect(serviceCallsMentioning(BRAND_A)).toEqual([]);
  });
});

describe("brand id in the request body cannot redirect a write to another tenant", () => {
  it("PUT brands/[id] ignores a body id pointing at Brand B", async () => {
    setSessionUser(USERS.ownerA);
    const route = BRAND_ROUTES.find((r) => r.name === "PUT brands/[id]")!;
    const response = await callRoute(route, BRAND_A, { id: BRAND_B, name: "Hijacked" });
    expect(response.status).toBe(200);
    const setCall = dbCalls.find((c) => c.path === "update.set");
    expect(setCall).toBeDefined();
    const values = setCall!.args[0] as Record<string, unknown>;
    expect(values).not.toHaveProperty("id");
    expect(values).toMatchObject({ name: "Hijacked" });
    expect(JSON.stringify(values)).not.toContain(BRAND_B);
  });

  it("POST sync scopes the connection lookup to the authorized brand", async () => {
    setSessionUser(USERS.ownerA);
    const route = BRAND_ROUTES.find((r) => r.name === "POST sync")!;
    const response = await callRoute(route, BRAND_A, { platform: "meta", brandId: BRAND_B });
    expect(response.status).toBe(200);
    expect(serviceCallsMentioning(BRAND_B)).toEqual([]);
    expect(serviceCallsMentioning(BRAND_A)).toEqual(
      expect.arrayContaining(["adsSync.syncAdData"])
    );
  });

  it("POST capi/send uses the URL brand, never a body brandId", async () => {
    setSessionUser(USERS.managerA);
    const route = BRAND_ROUTES.find((r) => r.name === "POST capi/send")!;
    const response = await callRoute(route, BRAND_A, { eventType: "Lead", userData: {}, brandId: BRAND_B });
    expect(response.status).toBe(200);
    expect(serviceCallsMentioning(BRAND_B)).toEqual([]);
    expect(serviceCallsMentioning(BRAND_A)).toContain("capi.sendLeadEvent");
  });
});

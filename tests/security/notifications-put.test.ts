import { describe, expect, it } from "vitest";
import { BRAND_ROUTES, callRoute } from "../helpers/routes";
import { setSessionUser } from "../helpers/session";
import { BRAND_A, BRAND_B, USERS } from "../helpers/world";
import { dbCalls, setDbResult } from "../helpers/fake-db";

const PUT = BRAND_ROUTES.find((r) => r.name === "PUT notifications")!;

const MALICIOUS_BODY = {
  id: "99999999-9999-4999-8999-999999999999",
  brandId: BRAND_B,
  userId: USERS.ownerB,
  createdAt: "2000-01-01T00:00:00Z",
  enabled: false,
  telegramChatId: "42",
  lowRoasThreshold: "1.5",
};

describe("PUT notifications (mass assignment)", () => {
  it("insert: body brandId/userId/id are ignored; row is bound to the caller and URL brand", async () => {
    setSessionUser(USERS.managerA);
    const response = await callRoute(PUT, BRAND_A, MALICIOUS_BODY);
    expect(response.status).toBe(200);

    const insert = dbCalls.find((c) => c.path === "insert.values");
    expect(insert).toBeDefined();
    const values = insert!.args[0] as Record<string, unknown>;
    expect(values.brandId).toBe(BRAND_A);
    expect(values.userId).toBe(USERS.managerA);
    expect(values).not.toHaveProperty("id");
    expect(values).not.toHaveProperty("createdAt");
    expect(values).toMatchObject({ enabled: false, telegramChatId: "42", lowRoasThreshold: "1.5" });
  });

  it("update: only allowlisted fields are written", async () => {
    setSessionUser(USERS.managerA);
    setDbResult("query.notificationPreferences.findFirst", {
      id: "88888888-8888-4888-8888-888888888888",
      brandId: BRAND_A,
      userId: USERS.managerA,
    });

    const response = await callRoute(PUT, BRAND_A, MALICIOUS_BODY);
    expect(response.status).toBe(200);

    const set = dbCalls.find((c) => c.path === "update.set");
    const values = set!.args[0] as Record<string, unknown>;
    for (const forbidden of ["id", "brandId", "userId", "createdAt"]) {
      expect(values).not.toHaveProperty(forbidden);
    }
    expect(values).toMatchObject({ enabled: false, telegramChatId: "42" });
    expect(dbCalls.some((c) => c.path === "insert.values")).toBe(false);
  });

  it.each([
    [{ enabled: "yes" }],
    [{ lowRoasThreshold: "abc" }],
    [{ quietHoursStart: "25:99" }],
    [{ telegramChatId: "x".repeat(300) }],
  ])("rejects invalid input %j with 400 and writes nothing", async (body) => {
    setSessionUser(USERS.managerA);
    const response = await callRoute(PUT, BRAND_A, body);
    expect(response.status).toBe(400);
    expect(dbCalls.some((c) => c.path.startsWith("insert") || c.path.startsWith("update"))).toBe(false);
  });
});

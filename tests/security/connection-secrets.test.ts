import { describe, expect, it } from "vitest";
import { BRAND_ROUTES, callRoute } from "../helpers/routes";
import { setSessionUser } from "../helpers/session";
import { BRAND_A, USERS } from "../helpers/world";
import { FAKE_CONNECTION, setDbResult } from "../helpers/fake-db";
import { toPublicConnection } from "@/lib/platforms/connection-view";

const SECRET_VALUES = [
  FAKE_CONNECTION.accessToken,
  FAKE_CONNECTION.refreshToken,
  FAKE_CONNECTION.metadata.webhookSecret,
  FAKE_CONNECTION.metadata.clientSecret,
  FAKE_CONNECTION.metadata.developerToken,
  FAKE_CONNECTION.metadata.appSecret,
  FAKE_CONNECTION.metadata.testCode,
];
const SECRET_KEYS = ["accessToken", "refreshToken", "webhookSecret", "clientSecret", "developerToken", "appSecret", "testCode"];

describe("toPublicConnection", () => {
  it("keeps only allowlisted, non-secret fields", () => {
    const view = toPublicConnection({ ...FAKE_CONNECTION, brandId: BRAND_A } as never);
    const serialized = JSON.stringify(view);
    for (const secret of SECRET_VALUES) expect(serialized).not.toContain(secret);
    for (const key of SECRET_KEYS) expect(serialized).not.toContain(`"${key}"`);
    expect(view.metadata).toEqual({ myshopifyDomain: "demo.myshopify.com", pixelId: "123456" });
    expect(view.accountId).toBe("demo.myshopify.com");
  });
});

describe("GET connections/* never returns secrets (even to owners)", () => {
  const getRoutes = BRAND_ROUTES.filter((r) => r.method === "GET" && r.name.startsWith("GET connections/"));

  it("covers all five platforms", () => {
    expect(getRoutes.map((r) => r.name).sort()).toEqual([
      "GET connections/google",
      "GET connections/meta",
      "GET connections/shopify",
      "GET connections/snapchat",
      "GET connections/tiktok",
    ]);
  });

  it.each(getRoutes)("$name", async (route) => {
    setSessionUser(USERS.ownerA);
    setDbResult("query.platformConnections.findFirst", { ...FAKE_CONNECTION, brandId: BRAND_A });

    const response = await callRoute(route, BRAND_A);
    expect(response.status).toBe(200);
    const text = await response.text();

    expect(JSON.parse(text).connected).toBe(true);
    for (const secret of SECRET_VALUES) expect(text).not.toContain(secret);
    for (const key of SECRET_KEYS) expect(text).not.toContain(`"${key}"`);
  });
});

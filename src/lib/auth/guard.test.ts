import { describe, expect, it } from "vitest";
import {
  AuthorizationError,
  authorizeBrandRequest,
  requireBrandRole,
  requireUser,
} from "./guard";
import { setSession, setSessionUser } from "../../../tests/helpers/session";
import { BRAND_A, BRAND_B, BRAND_MISSING, PERSONAS, USERS } from "../../../tests/helpers/world";
import type { BrandRole } from "./roles";

async function expectAuthzError(promise: Promise<unknown>, status: 401 | 403 | 404) {
  const error = await promise.then(
    () => {
      throw new Error("expected AuthorizationError");
    },
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(AuthorizationError);
  expect((error as AuthorizationError).status).toBe(status);
}

describe("requireUser", () => {
  it("rejects anonymous requests with 401", async () => {
    setSession(null);
    await expectAuthzError(requireUser(), 401);
  });

  it("returns the session user id", async () => {
    setSessionUser(USERS.viewerA);
    await expect(requireUser()).resolves.toEqual({ userId: USERS.viewerA });
  });
});

describe("requireBrandRole", () => {
  const ROLES: BrandRole[] = ["viewer", "manager", "owner"];
  const RANK: Record<BrandRole, number> = { viewer: 1, manager: 2, owner: 3 };

  for (const persona of PERSONAS) {
    for (const minimum of ROLES) {
      const expected =
        persona.userId === null
          ? 401
          : persona.roleInBrandA === null
            ? 404
            : RANK[persona.roleInBrandA] >= RANK[minimum]
              ? "allow"
              : 403;

      it(`${persona.label} requiring ${minimum} on Brand A → ${expected}`, async () => {
        setSession(persona);
        if (expected === "allow") {
          await expect(requireBrandRole(BRAND_A, minimum)).resolves.toEqual({
            userId: persona.userId,
            brandId: BRAND_A,
            role: persona.roleInBrandA,
          });
        } else {
          await expectAuthzError(requireBrandRole(BRAND_A, minimum), expected);
        }
      });
    }
  }

  it("treats a non-existent brand exactly like a brand the user is not in (404)", async () => {
    setSessionUser(USERS.ownerA);
    await expectAuthzError(requireBrandRole(BRAND_MISSING, "viewer"), 404);
  });

  it("does not let an owner of Brand A act on Brand B (404)", async () => {
    setSessionUser(USERS.ownerA);
    await expectAuthzError(requireBrandRole(BRAND_B, "viewer"), 404);
  });

  it.each(["", "not-a-uuid", "../../etc/passwd", "' OR '1'='1", 123, null, undefined, { id: BRAND_A }])(
    "rejects malformed brand id %p with 404",
    async (bad) => {
      setSessionUser(USERS.ownerA);
      await expectAuthzError(requireBrandRole(bad, "viewer"), 404);
    }
  );

  it("checks authentication before touching the brand id", async () => {
    setSession(null);
    await expectAuthzError(requireBrandRole("not-a-uuid", "viewer"), 401);
  });

  it("does not grant platform admins implicit brand access", async () => {
    setSession({ userId: USERS.platformAdmin, platformRole: "admin" });
    await expectAuthzError(requireBrandRole(BRAND_A, "viewer"), 404);
  });
});

describe("authorizeBrandRequest", () => {
  it("returns a JSON response with the right status instead of throwing", async () => {
    setSessionUser(USERS.viewerA);
    const denied = await authorizeBrandRequest(BRAND_A, "owner");
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.response.status).toBe(403);
      expect(await denied.response.json()).toEqual({ error: "Forbidden" });
    }

    const allowed = await authorizeBrandRequest(BRAND_A, "viewer");
    expect(allowed).toEqual({
      ok: true,
      context: { userId: USERS.viewerA, brandId: BRAND_A, role: "viewer" },
    });
  });
});

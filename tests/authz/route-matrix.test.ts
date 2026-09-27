/**
 * Authorization matrix: every brand-scoped API route × every persona.
 *
 *   unauthenticated                  → 401
 *   authenticated non-member         → 404 (brand existence is not revealed)
 *   platform admin, no membership    → 404 (no implicit tenant access)
 *   member below the route's role    → 403
 *   member at/above the route's role → handled (2xx)
 *
 * Denied requests must never reach the data layer.
 */
import { describe, expect, it } from "vitest";
import { BRAND_ROUTES, callRoute } from "../helpers/routes";
import { setSession } from "../helpers/session";
import { BRAND_A, PERSONAS, type Persona } from "../helpers/world";
import { dbCalls } from "../helpers/fake-db";
import { calledServices } from "../helpers/services";
import type { BrandRole } from "@/lib/auth/roles";

const RANK: Record<BrandRole, number> = { viewer: 1, manager: 2, owner: 3 };

function expectedStatus(persona: Persona, minRole: BrandRole): number | "allowed" {
  if (persona.userId === null) return 401;
  if (persona.roleInBrandA === null) return 404;
  return RANK[persona.roleInBrandA] >= RANK[minRole] ? "allowed" : 403;
}

describe.each(BRAND_ROUTES)("$name (min role: $minRole)", (route) => {
  it.each(PERSONAS)("$label", async (persona) => {
    setSession(persona);
    const expected = expectedStatus(persona, route.minRole);

    const response = await callRoute(route, BRAND_A);

    if (expected === "allowed") {
      expect(response.status, await response.clone().text()).toBeGreaterThanOrEqual(200);
      expect(response.status, await response.clone().text()).toBeLessThan(300);
    } else {
      expect(response.status).toBe(expected);
      expect(dbCalls, "denied request must not touch the database").toHaveLength(0);
      expect(calledServices(), "denied request must not call services").toEqual([]);
    }
  });
});

describe("route inventory", () => {
  it("covers every brand-scoped route handler", () => {
    const names = new Set(BRAND_ROUTES.map((r) => r.name));
    // 25 brand-scoped handler files expose these 41 method/route combinations
    // (37 from Phase 1 + 4 V1 profit dashboard routes).
    expect(names.size).toBe(BRAND_ROUTES.length);
    expect(BRAND_ROUTES.length).toBe(41);
  });
});

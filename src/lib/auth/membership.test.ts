import { describe, expect, it, vi } from "vitest";
import { dbCalls, setDbResult } from "../../../tests/helpers/fake-db";

// The global setup replaces membership lookups with an in-memory world;
// this file tests the real implementation against the fake database.
const actual = await vi.importActual<typeof import("./membership")>("./membership");
const { getBrandMembership, brandExists, isUuid } = actual;

const BRAND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "10000000-0000-4000-8000-000000000001";
const MEMBERSHIP_QUERY = "select.from.innerJoin.where";

describe("isUuid", () => {
  it("accepts canonical UUIDs and rejects everything else", () => {
    expect(isUuid(BRAND)).toBe(true);
    expect(isUuid(BRAND.toUpperCase())).toBe(true);
    for (const bad of ["", "abc", `${BRAND}x`, "' OR 1=1 --", null, undefined, 42]) {
      expect(isUuid(bad)).toBe(false);
    }
  });
});

describe("getBrandMembership (real implementation)", () => {
  it("returns null without querying for malformed ids", async () => {
    expect(await getBrandMembership(USER, "not-a-uuid")).toBeNull();
    expect(await getBrandMembership("not-a-uuid", BRAND)).toBeNull();
    expect(dbCalls).toHaveLength(0);
  });

  it("joins brand_users to brands so a deleted/missing brand yields no membership", async () => {
    setDbResult(MEMBERSHIP_QUERY, []);
    expect(await getBrandMembership(USER, BRAND)).toBeNull();
    expect(dbCalls.map((c) => c.path)).toEqual(
      expect.arrayContaining(["select", "select.from", "select.from.innerJoin", "select.from.innerJoin.where"])
    );
  });

  it("returns the member's role", async () => {
    setDbResult(MEMBERSHIP_QUERY, [{ brandId: BRAND, role: "manager" }]);
    expect(await getBrandMembership(USER, BRAND)).toEqual({ brandId: BRAND, role: "manager" });
  });

  it("uses the least privileged role when duplicate membership rows exist", async () => {
    setDbResult(MEMBERSHIP_QUERY, [
      { brandId: BRAND, role: "owner" },
      { brandId: BRAND, role: "viewer" },
    ]);
    expect(await getBrandMembership(USER, BRAND)).toEqual({ brandId: BRAND, role: "viewer" });
  });

  it("ignores rows with unknown roles", async () => {
    setDbResult(MEMBERSHIP_QUERY, [{ brandId: BRAND, role: "superuser" }]);
    expect(await getBrandMembership(USER, BRAND)).toBeNull();
  });
});

describe("brandExists (real implementation)", () => {
  it("is false for malformed ids without querying", async () => {
    expect(await brandExists("nope")).toBe(false);
    expect(dbCalls).toHaveLength(0);
  });

  it("reflects whether the brand row exists", async () => {
    setDbResult("select.from.where.limit", [{ id: BRAND }]);
    expect(await brandExists(BRAND)).toBe(true);
    setDbResult("select.from.where.limit", []);
    expect(await brandExists(BRAND)).toBe(false);
  });
});

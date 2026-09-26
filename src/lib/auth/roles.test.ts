import { describe, expect, it } from "vitest";
import { BRAND_ROLES, hasMinimumRole, isBrandRole, leastPrivilegedRole } from "./roles";

describe("brand role hierarchy", () => {
  it("is ordered viewer < manager < owner", () => {
    expect(BRAND_ROLES).toEqual(["viewer", "manager", "owner"]);
  });

  it.each([
    ["viewer", "viewer", true],
    ["viewer", "manager", false],
    ["viewer", "owner", false],
    ["manager", "viewer", true],
    ["manager", "manager", true],
    ["manager", "owner", false],
    ["owner", "viewer", true],
    ["owner", "manager", true],
    ["owner", "owner", true],
  ] as const)("%s satisfies minimum %s → %s", (role, minimum, expected) => {
    expect(hasMinimumRole(role, minimum)).toBe(expected);
  });

  it.each([null, undefined, "", "admin", "operator", "OWNER", 3, {}])(
    "never grants access for missing/unknown role %p",
    (role) => {
      expect(hasMinimumRole(role, "viewer")).toBe(false);
      expect(isBrandRole(role)).toBe(false);
    }
  );

  it("picks the least privileged role when duplicates exist", () => {
    expect(leastPrivilegedRole(["owner", "viewer", "manager"])).toBe("viewer");
    expect(leastPrivilegedRole(["owner", "bogus"])).toBe("owner");
    expect(leastPrivilegedRole([])).toBeNull();
    expect(leastPrivilegedRole(["bogus"])).toBeNull();
  });
});

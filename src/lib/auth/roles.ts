/**
 * Brand (tenant) role hierarchy.
 *
 * Roles are ordered: viewer < manager < owner.
 * A missing or unknown role never satisfies any requirement.
 */
export const BRAND_ROLES = ["viewer", "manager", "owner"] as const;

export type BrandRole = (typeof BRAND_ROLES)[number];

const ROLE_RANK: Readonly<Record<BrandRole, number>> = Object.freeze({
  viewer: 1,
  manager: 2,
  owner: 3,
});

export function isBrandRole(value: unknown): value is BrandRole {
  return (
    typeof value === "string" &&
    (BRAND_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Returns true only when `role` is a known brand role whose rank is at least
 * the rank of `minimum`.
 */
export function hasMinimumRole(
  role: unknown,
  minimum: BrandRole
): boolean {
  if (!isBrandRole(role)) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/**
 * Of several roles, return the least privileged one (or null if none are valid).
 * Used when duplicate membership rows exist, so privileges are never widened.
 */
export function leastPrivilegedRole(roles: readonly unknown[]): BrandRole | null {
  let result: BrandRole | null = null;
  for (const role of roles) {
    if (!isBrandRole(role)) continue;
    if (result === null || ROLE_RANK[role] < ROLE_RANK[result]) {
      result = role;
    }
  }
  return result;
}

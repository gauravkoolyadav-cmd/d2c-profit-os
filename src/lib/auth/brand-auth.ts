import { getBrandMembership } from "./membership";
import { hasMinimumRole, type BrandRole } from "./roles";

/**
 * Returns the user's role in the brand, or null if the brand does not exist or
 * the user is not a member.
 *
 * Prefer `requireBrandRole` / `authorizeBrandRequest` from "./guard" in route
 * handlers; this helper remains for pages and server actions.
 */
export async function hasBrandAccess(
  userId: string,
  brandId: string
): Promise<BrandRole | null> {
  const membership = await getBrandMembership(userId, brandId);
  return membership?.role ?? null;
}

export async function canManageBrand(userId: string, brandId: string): Promise<boolean> {
  return hasMinimumRole(await hasBrandAccess(userId, brandId), "manager");
}

export async function canEditBrand(userId: string, brandId: string): Promise<boolean> {
  return hasMinimumRole(await hasBrandAccess(userId, brandId), "manager");
}

export async function isBrandOwner(userId: string, brandId: string): Promise<boolean> {
  return hasMinimumRole(await hasBrandAccess(userId, brandId), "owner");
}

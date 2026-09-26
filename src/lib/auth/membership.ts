import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { brands, brandUsers } from "@/lib/db/schema";
import { leastPrivilegedRole, type BrandRole } from "./roles";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Brand, user and other primary keys in this schema are UUIDs. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export interface BrandMembership {
  brandId: string;
  role: BrandRole;
}

/**
 * Look up a user's membership of a brand.
 *
 * The join on `brands` means a result is returned only when the brand exists
 * AND the user is a member of it. If duplicate membership rows exist
 * (brand_users has no unique constraint yet), the least privileged role wins.
 */
export async function getBrandMembership(
  userId: string,
  brandId: string
): Promise<BrandMembership | null> {
  if (!isUuid(userId) || !isUuid(brandId)) return null;

  const rows = await db
    .select({ brandId: brands.id, role: brandUsers.role })
    .from(brandUsers)
    .innerJoin(brands, eq(brands.id, brandUsers.brandId))
    .where(and(eq(brandUsers.brandId, brandId), eq(brandUsers.userId, userId)));

  if (rows.length === 0) return null;

  const role = leastPrivilegedRole(rows.map((row) => row.role));
  if (!role) return null;

  return { brandId: rows[0].brandId, role };
}

/** True when a brand with this id exists. Used by public, brand-scoped endpoints. */
export async function brandExists(brandId: string): Promise<boolean> {
  if (!isUuid(brandId)) return false;
  const rows = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  return rows.length > 0;
}

/**
 * Fixed multi-tenant test world.
 *
 * Brand A and Brand B are separate tenants. Every persona is defined relative
 * to Brand A, plus `ownerB`, who owns Brand B only and acts as the
 * cross-tenant attacker.
 */
import type { BrandRole } from "@/lib/auth/roles";

export const BRAND_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const BRAND_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
/** Well-formed UUID that belongs to no brand. */
export const BRAND_MISSING = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

export const SUBSCRIPTION_A = "5aaaaaaa-0000-4000-8000-00000000000a";
export const SUBSCRIPTION_B = "5bbbbbbb-0000-4000-8000-00000000000b";

export interface Persona {
  key: string;
  label: string;
  /** null = not signed in */
  userId: string | null;
  platformRole: "admin" | "operator";
  /** Role in Brand A (null = not a member of Brand A) */
  roleInBrandA: BrandRole | null;
}

export const USERS = {
  ownerA: "10000000-0000-4000-8000-000000000001",
  managerA: "10000000-0000-4000-8000-000000000002",
  viewerA: "10000000-0000-4000-8000-000000000003",
  outsider: "10000000-0000-4000-8000-000000000004",
  platformAdmin: "10000000-0000-4000-8000-000000000005",
  ownerB: "10000000-0000-4000-8000-000000000006",
  ownerAandB: "10000000-0000-4000-8000-000000000007",
} as const;

/** brandId -> userId -> role */
export const MEMBERSHIPS: Record<string, Record<string, BrandRole>> = {
  [BRAND_A]: {
    [USERS.ownerA]: "owner",
    [USERS.managerA]: "manager",
    [USERS.viewerA]: "viewer",
    [USERS.ownerAandB]: "owner",
  },
  [BRAND_B]: {
    [USERS.ownerB]: "owner",
    [USERS.ownerAandB]: "owner",
  },
};

export const EXISTING_BRANDS = new Set([BRAND_A, BRAND_B]);

export const PERSONAS: Persona[] = [
  { key: "anonymous", label: "unauthenticated user", userId: null, platformRole: "operator", roleInBrandA: null },
  { key: "nonMember", label: "authenticated non-member", userId: USERS.outsider, platformRole: "operator", roleInBrandA: null },
  { key: "platformAdmin", label: "platform admin (users.role=admin) without membership", userId: USERS.platformAdmin, platformRole: "admin", roleInBrandA: null },
  { key: "viewer", label: "viewer", userId: USERS.viewerA, platformRole: "operator", roleInBrandA: "viewer" },
  { key: "member", label: "member (manager)", userId: USERS.managerA, platformRole: "operator", roleInBrandA: "manager" },
  { key: "owner", label: "owner", userId: USERS.ownerA, platformRole: "operator", roleInBrandA: "owner" },
];

export const ATTACKER_OWNER_B: Persona = {
  key: "ownerB",
  label: "owner of Brand B",
  userId: USERS.ownerB,
  platformRole: "operator",
  roleInBrandA: null,
};

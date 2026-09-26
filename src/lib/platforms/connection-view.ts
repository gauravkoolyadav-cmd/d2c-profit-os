import type { platformConnections } from "@/lib/db/schema";

type PlatformConnectionRow = typeof platformConnections.$inferSelect;

/**
 * Metadata keys that are safe to return to any brand member.
 * Everything else (client secrets, app secrets, developer tokens, webhook
 * secrets, refresh tokens, test codes, ...) is withheld.
 */
const PUBLIC_METADATA_KEYS = [
  "apiDomain",
  "myshopifyDomain",
  "businessAccountId",
  "adAccountId",
  "customerId",
  "pixelId",
] as const;

type PublicMetadataKey = (typeof PUBLIC_METADATA_KEYS)[number];

export interface PublicPlatformConnection {
  id: string;
  brandId: string;
  platform: PlatformConnectionRow["platform"];
  accountId: string;
  status: PlatformConnectionRow["status"];
  scopes: string | null;
  tokenExpiresAt: Date | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  metadata: Partial<Record<PublicMetadataKey, string>>;
}

/**
 * Allowlist-based view of a platform connection for API responses.
 * Never includes accessToken, refreshToken or secret metadata.
 */
export function toPublicConnection(
  connection: PlatformConnectionRow
): PublicPlatformConnection {
  const metadata: Partial<Record<PublicMetadataKey, string>> = {};
  const source = (connection.metadata ?? {}) as Record<string, unknown>;

  for (const key of PUBLIC_METADATA_KEYS) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) {
      metadata[key] = value;
    }
  }

  return {
    id: connection.id,
    brandId: connection.brandId,
    platform: connection.platform,
    accountId: connection.accountId,
    status: connection.status,
    scopes: connection.scopes ?? null,
    tokenExpiresAt: connection.tokenExpiresAt ?? null,
    lastSyncedAt: connection.lastSyncedAt ?? null,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    metadata,
  };
}

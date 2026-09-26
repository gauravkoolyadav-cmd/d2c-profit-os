import { db } from "@/lib/db";
import { platformConnections } from "@/lib/db/schema";
import { authorizeBrandRequest } from "@/lib/auth/guard";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import { syncAdData, logSync, type AdPlatformConfig } from "@/lib/platforms/ads/sync";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const AD_PLATFORMS = ["meta", "snapchat", "google", "tiktok"] as const;
type AdPlatform = (typeof AD_PLATFORMS)[number];

function isAdPlatform(value: unknown): value is AdPlatform {
  return typeof value === "string" && (AD_PLATFORMS as readonly string[]).includes(value);
}

export async function POST(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "manager");
  if (!authz.ok) return authz.response;
  const { brandId } = authz.context;

  let platform: AdPlatform | undefined;

  try {
    const body = await req.json();
    const { date } = body;

    if (!body.platform) {
      return NextResponse.json({ error: "Platform is required" }, { status: 400 });
    }

    if (!isAdPlatform(body.platform)) {
      return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
    }
    platform = body.platform;

    // Get the connection (always scoped to the authorized brand)
    const connection = await db.query.platformConnections.findFirst({
      where: and(
        eq(platformConnections.brandId, brandId),
        eq(platformConnections.platform, body.platform)
      ),
    });

    if (!connection) {
      return NextResponse.json({ error: "No connection found for this platform" }, { status: 404 });
    }

    if (connection.status !== "active") {
      return NextResponse.json({ error: "Connection is not active" }, { status: 400 });
    }

    // Build config based on platform
    const config: AdPlatformConfig = {
      platform: body.platform,
      accessToken: connection.accessToken,
      accountId: connection.accountId,
      refreshToken: connection.refreshToken || undefined,
    };

    // Add platform-specific config from metadata
    if (connection.metadata) {
      if (connection.metadata.clientId) config.clientId = connection.metadata.clientId;
      if (connection.metadata.clientSecret) config.clientSecret = connection.metadata.clientSecret;
      if (connection.metadata.developerToken) config.developerToken = connection.metadata.developerToken;
      if (connection.metadata.customerId) config.customerId = connection.metadata.customerId;
      if (connection.metadata.appId) config.appId = connection.metadata.appId;
      if (connection.metadata.appSecret) config.appSecret = connection.metadata.appSecret;
    }

    // Use today's date if not provided
    const syncDate = date || new Date().toISOString().split("T")[0];

    await logSync(brandId, body.platform, "ad_data", "started", 0);

    const result = await syncAdData(brandId, config, syncDate);

    const totalRecords = result.campaigns + result.adSets + result.ads + result.snapshots;
    const status = result.errors > 0 ? "partial" : "success";
    await logSync(brandId, body.platform, "ad_data", status, totalRecords);

    return NextResponse.json({
      success: true,
      result: {
        campaigns: result.campaigns,
        adSets: result.adSets,
        ads: result.ads,
        snapshots: result.snapshots,
        errors: result.errors,
      },
    });
  } catch (error) {
    console.error("Error syncing ad data:", error);

    if (platform) {
      try {
        await logSync(
          brandId,
          platform,
          "ad_data",
          "failed",
          0,
          error instanceof Error ? error.message : "Unknown error"
        );
      } catch {
        // Ignore logging errors
      }
    }

    return NextResponse.json({ error: "Failed to sync ad data" }, { status: 500 });
  }
}

export async function GET(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "viewer");
  if (!authz.ok) return authz.response;
  const { brandId } = authz.context;

  try {
    const connections = await db.query.platformConnections.findMany({
      where: eq(platformConnections.brandId, brandId),
    });

    const adPlatforms = connections.filter((c) => isAdPlatform(c.platform));

    return NextResponse.json({
      connections: adPlatforms.map((c) => ({
        platform: c.platform,
        status: c.status,
        lastSyncedAt: c.lastSyncedAt,
        accountId: c.accountId,
      })),
    });
  } catch (error) {
    console.error("Error fetching sync status:", error);
    return NextResponse.json({ error: "Failed to fetch sync status" }, { status: 500 });
  }
}

import { db } from "@/lib/db";
import { platformConnections } from "@/lib/db/schema";
import { authorizeBrandRequest } from "@/lib/auth/guard";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import { GoogleAdsClient } from "@/lib/platforms/google/client";
import { toPublicConnection } from "@/lib/platforms/connection-view";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "viewer");
  if (!authz.ok) return authz.response;
  const { brandId } = authz.context;

  try {
    const connection = await db.query.platformConnections.findFirst({
      where: and(
        eq(platformConnections.brandId, brandId),
        eq(platformConnections.platform, "google")
      ),
    });

    if (!connection) {
      return NextResponse.json({ connected: false });
    }

    // Never expose access/refresh tokens, client secret or developer token
    return NextResponse.json({ connected: true, connection: toPublicConnection(connection) });
  } catch (error) {
    console.error("Error fetching Google Ads connection:", error);
    return NextResponse.json({ error: "Failed to fetch connection" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "manager");
  if (!authz.ok) return authz.response;
  const { brandId } = authz.context;

  try {
    const body = await req.json();
    const { developerToken, clientId, clientSecret, refreshToken, customerId } = body;

    if (!developerToken || !clientId || !clientSecret || !refreshToken || !customerId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Validate credentials by making a test request
    const client = new GoogleAdsClient({
      developerToken,
      clientId,
      clientSecret,
      refreshToken,
      customerId,
    });
    try {
      await client.getCampaigns();
    } catch {
      return NextResponse.json({ error: "Invalid Google Ads credentials" }, { status: 400 });
    }

    const existing = await db.query.platformConnections.findFirst({
      where: and(
        eq(platformConnections.brandId, brandId),
        eq(platformConnections.platform, "google")
      ),
    });

    const metadata = {
      developerToken,
      clientId,
      clientSecret,
      customerId,
    };

    if (existing) {
      await db
        .update(platformConnections)
        .set({
          accountId: customerId,
          refreshToken,
          status: "active",
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
          metadata,
        })
        .where(
          and(
            eq(platformConnections.id, existing.id),
            eq(platformConnections.brandId, brandId)
          )
        );
    } else {
      await db.insert(platformConnections).values({
        brandId,
        platform: "google",
        accountId: customerId,
        accessToken: "", // Will be generated via refresh token
        refreshToken,
        status: "active",
        lastSyncedAt: new Date(),
        metadata,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error creating Google Ads connection:", error);
    return NextResponse.json({ error: "Failed to connect account" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "owner");
  if (!authz.ok) return authz.response;
  const { brandId } = authz.context;

  try {
    await db
      .delete(platformConnections)
      .where(
        and(
          eq(platformConnections.brandId, brandId),
          eq(platformConnections.platform, "google")
        )
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting Google Ads connection:", error);
    return NextResponse.json({ error: "Failed to disconnect account" }, { status: 500 });
  }
}

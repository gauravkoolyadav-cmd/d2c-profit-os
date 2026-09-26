import { db } from "@/lib/db";
import { platformConnections } from "@/lib/db/schema";
import { authorizeBrandRequest } from "@/lib/auth/guard";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import { SnapchatClient } from "@/lib/platforms/snapchat/client";
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
        eq(platformConnections.platform, "snapchat")
      ),
    });

    if (!connection) {
      return NextResponse.json({ connected: false });
    }

    // Never expose access/refresh tokens or client secret
    return NextResponse.json({ connected: true, connection: toPublicConnection(connection) });
  } catch (error) {
    console.error("Error fetching Snapchat connection:", error);
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
    const { clientId, clientSecret, accessToken, refreshToken } = body;

    if (!clientId || !clientSecret || !accessToken) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Validate credentials by making a test request
    const client = new SnapchatClient({ clientId, clientSecret, accessToken, refreshToken });
    try {
      await client.getCampaigns();
    } catch {
      return NextResponse.json({ error: "Invalid Snapchat credentials" }, { status: 400 });
    }

    const existing = await db.query.platformConnections.findFirst({
      where: and(
        eq(platformConnections.brandId, brandId),
        eq(platformConnections.platform, "snapchat")
      ),
    });

    const metadata: Record<string, string> = { clientId, clientSecret };
    if (refreshToken) {
      metadata.refreshToken = refreshToken;
    }

    if (existing) {
      await db
        .update(platformConnections)
        .set({
          accountId: clientId,
          accessToken,
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
        platform: "snapchat",
        accountId: clientId,
        accessToken,
        refreshToken,
        status: "active",
        lastSyncedAt: new Date(),
        metadata,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error creating Snapchat connection:", error);
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
          eq(platformConnections.platform, "snapchat")
        )
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting Snapchat connection:", error);
    return NextResponse.json({ error: "Failed to disconnect account" }, { status: 500 });
  }
}

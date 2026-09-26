import { db } from "@/lib/db";
import { platformConnections } from "@/lib/db/schema";
import { authorizeBrandRequest } from "@/lib/auth/guard";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ShopifyClient } from "@/lib/platforms/shopify";
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
        eq(platformConnections.platform, "shopify")
      ),
    });

    if (!connection) {
      return NextResponse.json({ connected: false });
    }

    return NextResponse.json({ connected: true, connection: toPublicConnection(connection) });
  } catch (error) {
    console.error("Error fetching Shopify connection:", error);
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
    const { storeDomain, accessToken } = body;

    if (!storeDomain || !accessToken) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Validate credentials by making a test request
    const client = new ShopifyClient({ storeDomain, accessToken });
    try {
      await client.getShop();
    } catch {
      return NextResponse.json({ error: "Invalid Shopify credentials" }, { status: 400 });
    }

    // Check for existing connection
    const existing = await db.query.platformConnections.findFirst({
      where: and(
        eq(platformConnections.brandId, brandId),
        eq(platformConnections.platform, "shopify")
      ),
    });

    if (existing) {
      await db
        .update(platformConnections)
        .set({
          accountId: storeDomain,
          accessToken,
          status: "active",
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
          metadata: { myshopifyDomain: storeDomain },
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
        platform: "shopify",
        accountId: storeDomain,
        accessToken,
        status: "active",
        lastSyncedAt: new Date(),
        metadata: { myshopifyDomain: storeDomain },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error creating Shopify connection:", error);
    return NextResponse.json({ error: "Failed to connect store" }, { status: 500 });
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
          eq(platformConnections.platform, "shopify")
        )
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting Shopify connection:", error);
    return NextResponse.json({ error: "Failed to disconnect store" }, { status: 500 });
  }
}

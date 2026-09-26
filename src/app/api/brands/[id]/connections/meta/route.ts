import { db } from "@/lib/db";
import { platformConnections } from "@/lib/db/schema";
import { authorizeBrandRequest } from "@/lib/auth/guard";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import { MetaClient } from "@/lib/platforms/meta/client";
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
        eq(platformConnections.platform, "meta")
      ),
    });

    if (!connection) {
      return NextResponse.json({ connected: false });
    }

    return NextResponse.json({ connected: true, connection: toPublicConnection(connection) });
  } catch (error) {
    console.error("Error fetching Meta connection:", error);
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
    const { accessToken, accountId } = body;

    if (!accessToken || !accountId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Validate credentials by making a test request
    const client = new MetaClient({ accessToken });
    try {
      const accounts = await client.getAdAccounts();
      const isValidAccount = accounts.some((acc) => acc.account_id === accountId);
      if (!isValidAccount) {
        return NextResponse.json({ error: "Invalid ad account ID" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Invalid Meta credentials" }, { status: 400 });
    }

    // Check for existing connection
    const existing = await db.query.platformConnections.findFirst({
      where: and(
        eq(platformConnections.brandId, brandId),
        eq(platformConnections.platform, "meta")
      ),
    });

    if (existing) {
      await db
        .update(platformConnections)
        .set({
          accountId,
          accessToken,
          status: "active",
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
          metadata: { businessAccountId: accountId },
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
        platform: "meta",
        accountId,
        accessToken,
        status: "active",
        lastSyncedAt: new Date(),
        metadata: { businessAccountId: accountId },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error creating Meta connection:", error);
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
          eq(platformConnections.platform, "meta")
        )
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting Meta connection:", error);
    return NextResponse.json({ error: "Failed to disconnect account" }, { status: 500 });
  }
}

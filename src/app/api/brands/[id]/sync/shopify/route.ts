import { db } from "@/lib/db";
import { platformConnections } from "@/lib/db/schema";
import { authorizeBrandRequest } from "@/lib/auth/guard";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import { syncShopifyProducts, syncShopifyOrders } from "@/lib/platforms/shopify";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "manager");
  if (!authz.ok) return authz.response;
  const { brandId } = authz.context;

  try {
    const body = await req.json();
    const { type } = body;

    if (type !== "products" && type !== "orders") {
      return NextResponse.json({ error: "Invalid sync type" }, { status: 400 });
    }

    // Shopify connection, always scoped to the authorized brand
    const connection = await db.query.platformConnections.findFirst({
      where: and(
        eq(platformConnections.brandId, brandId),
        eq(platformConnections.platform, "shopify")
      ),
    });

    if (!connection) {
      return NextResponse.json({ error: "Shopify not connected" }, { status: 400 });
    }

    const { accountId: storeDomain, accessToken } = connection;

    if (type === "products") {
      const productsResult = await syncShopifyProducts(brandId, storeDomain, accessToken);
      return NextResponse.json({ type: "products", result: productsResult });
    }

    const ordersResult = await syncShopifyOrders(brandId, storeDomain, accessToken);
    return NextResponse.json({ type: "orders", result: ordersResult });
  } catch (error) {
    console.error("Error syncing Shopify data:", error);
    return NextResponse.json({ error: "Failed to sync data" }, { status: 500 });
  }
}

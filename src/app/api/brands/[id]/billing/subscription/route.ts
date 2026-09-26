import { NextResponse } from "next/server";
import { authorizeBrandRequest } from "@/lib/auth/guard";
import { isUuid } from "@/lib/auth/membership";
import { getBrandSubscription, cancelSubscription } from "@/lib/payments/management";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET - Get subscription details
 */
export async function GET(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "viewer");
  if (!authz.ok) return authz.response;
  const { brandId } = authz.context;

  try {
    const subscription = await getBrandSubscription(brandId);
    return NextResponse.json(subscription);
  } catch (error) {
    console.error("Error fetching subscription:", error);
    return NextResponse.json({ error: "Failed to fetch subscription" }, { status: 500 });
  }
}

/**
 * DELETE - Cancel this brand's subscription (brand owners only).
 * The subscription must belong to the brand in the URL.
 */
export async function DELETE(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "owner");
  if (!authz.ok) return authz.response;
  const { brandId } = authz.context;

  try {
    const body = await req.json();
    const { subscriptionId } = body;

    if (!subscriptionId) {
      return NextResponse.json({ error: "subscriptionId is required" }, { status: 400 });
    }

    if (!isUuid(subscriptionId)) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    const result = await cancelSubscription(subscriptionId, brandId);

    if (result.ok) {
      return NextResponse.json({ success: true });
    }
    if (result.reason === "not_found") {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to cancel subscription" }, { status: 502 });
  } catch (error) {
    console.error("Error canceling subscription:", error);
    return NextResponse.json({ error: "Failed to cancel subscription" }, { status: 500 });
  }
}

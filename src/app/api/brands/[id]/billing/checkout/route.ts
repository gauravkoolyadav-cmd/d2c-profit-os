import { NextResponse } from "next/server";
import { authorizeBrandRequest } from "@/lib/auth/guard";
import { createSubscriptionCheckout } from "@/lib/payments/management";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST - Create checkout session for subscription (brand owners only)
 */
export async function POST(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "owner");
  if (!authz.ok) return authz.response;
  const { brandId } = authz.context;

  try {
    const body = await req.json();
    const { tier, userEmail } = body;

    if (typeof tier !== "string" || !tier || typeof userEmail !== "string" || !userEmail) {
      return NextResponse.json({ error: "tier and userEmail are required" }, { status: 400 });
    }

    const result = await createSubscriptionCheckout(brandId, tier, userEmail);

    if (result) {
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  } catch (error) {
    console.error("Error creating checkout:", error);
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}

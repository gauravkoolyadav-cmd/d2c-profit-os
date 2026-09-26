import { NextResponse } from "next/server";
import { authorizeBrandRequest } from "@/lib/auth/guard";
import {
  sendMetaEvent,
  sendPurchaseEvent,
  sendInitiateCheckoutEvent,
  sendAddToCartEvent,
  sendViewContentEvent,
  sendLeadEvent,
  sendSearchEvent,
} from "@/lib/capi/meta";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST - Send a CAPI event
 */
export async function POST(
  req: Request,
  { params }: RouteContext
) {
  const { id } = await params;
  // Sending events uses the brand's stored Meta credentials: managers and owners only.
  const authz = await authorizeBrandRequest(id, "manager");
  if (!authz.ok) return authz.response;
  const { brandId } = authz.context;

  try {
    const body = await req.json();
    const {
      eventType,
      userData,
      customData,
      options,
    } = body;

    let result;

    switch (eventType) {
      case "Purchase":
        result = await sendPurchaseEvent(
          brandId,
          customData.orderId,
          customData.value,
          customData.currency,
          userData,
          customData.contents
        );
        break;

      case "InitiateCheckout":
        result = await sendInitiateCheckoutEvent(
          brandId,
          customData.value,
          customData.currency,
          userData,
          customData.contents
        );
        break;

      case "AddToCart":
        result = await sendAddToCartEvent(
          brandId,
          customData.value,
          customData.currency,
          userData,
          customData.contentIds
        );
        break;

      case "ViewContent":
        result = await sendViewContentEvent(
          brandId,
          customData.value,
          customData.currency,
          userData,
          customData.contentName,
          customData.contentIds
        );
        break;

      case "Lead":
        result = await sendLeadEvent(
          brandId,
          userData
        );
        break;

      case "Search":
        result = await sendSearchEvent(
          brandId,
          customData.searchTerm,
          userData
        );
        break;

      default:
        // Custom event
        result = await sendMetaEvent(
          brandId,
          eventType,
          userData,
          customData,
          options
        );
        break;
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error sending CAPI event:", error);
    return NextResponse.json(
      { error: "Failed to send CAPI event" },
      { status: 500 }
    );
  }
}

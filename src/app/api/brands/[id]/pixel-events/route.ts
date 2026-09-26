import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { trackPixelEvent } from "@/lib/attribution/tracking";
import { brandExists, isUuid } from "@/lib/auth/membership";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const optionalText = (max: number) => z.string().max(max).optional();

const pixelEventInput = z.object({
  // Accepted only for backward compatibility; must equal the brand in the URL.
  brandId: z.string().optional(),
  eventType: z.string().min(1).max(100),
  eventId: optionalText(200),
  sessionId: z.string().min(1).max(200),
  userAgent: optionalText(1000),
  ipHash: optionalText(128),
  referrer: optionalText(2048),
  pageUrl: z.string().min(1).max(2048),
  utmSource: optionalText(255),
  utmMedium: optionalText(255),
  utmCampaign: optionalText(255),
  utmContent: optionalText(255),
  utmTerm: optionalText(255),
  eventData: z
    .object({
      value: z.number().finite().optional(),
      currency: z.string().max(10).optional(),
      contentIds: z.array(z.string().max(200)).max(100).optional(),
      contentType: z.string().max(100).optional(),
      orderId: z.string().max(200).optional(),
    })
    .optional(),
});

/**
 * POST - Track a pixel event (public, client-side endpoint).
 *
 * This endpoint is intentionally unauthenticated (it is called from storefronts),
 * so the tenant is taken ONLY from the URL segment, the brand must exist, and
 * a conflicting brandId in the body is rejected.
 */
export async function POST(req: Request, { params }: RouteContext) {
  const { id: brandId } = await params;

  if (!isUuid(brandId)) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = pixelEventInput.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });
  }
  const body = parsed.data;

  if (body.brandId !== undefined && body.brandId !== brandId) {
    return NextResponse.json({ error: "brandId does not match URL" }, { status: 400 });
  }

  try {
    if (!(await brandExists(brandId))) {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }

    const eventId = body.eventId || randomUUID();

    await trackPixelEvent({
      brandId,
      eventType: body.eventType,
      eventId,
      sessionId: body.sessionId,
      userAgent: body.userAgent,
      ipHash: body.ipHash,
      referrer: body.referrer,
      pageUrl: body.pageUrl,
      utmSource: body.utmSource,
      utmMedium: body.utmMedium,
      utmCampaign: body.utmCampaign,
      utmContent: body.utmContent,
      utmTerm: body.utmTerm,
      eventData: body.eventData,
    });

    return NextResponse.json({ success: true, eventId });
  } catch (error) {
    console.error("Error tracking pixel event:", error);
    return NextResponse.json({ error: "Failed to track pixel event" }, { status: 500 });
  }
}

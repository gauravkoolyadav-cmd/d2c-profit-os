import { NextResponse } from "next/server";
import { authorizeBrandRequest } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { capiEvents } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const CAPI_PLATFORMS = ["meta", "snapchat", "google", "tiktok"] as const;
type CapiPlatform = (typeof CAPI_PLATFORMS)[number];

/**
 * GET - Get CAPI events for a brand
 */
export async function GET(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "viewer");
  if (!authz.ok) return authz.response;
  const { brandId } = authz.context;

  try {
    const { searchParams } = new URL(req.url);
    const platformParam = searchParams.get("platform");
    const platform = (CAPI_PLATFORMS as readonly string[]).includes(platformParam ?? "")
      ? (platformParam as CapiPlatform)
      : null;
    const parsedLimit = parseInt(searchParams.get("limit") || "50", 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50;

    const events = await db.query.capiEvents.findMany({
      where: platform
        ? and(eq(capiEvents.brandId, brandId), eq(capiEvents.platform, platform))
        : eq(capiEvents.brandId, brandId),
      orderBy: [desc(capiEvents.createdAt)],
      limit,
    });

    return NextResponse.json({ events });
  } catch (error) {
    console.error("Error fetching CAPI events:", error);
    return NextResponse.json({ error: "Failed to fetch CAPI events" }, { status: 500 });
  }
}

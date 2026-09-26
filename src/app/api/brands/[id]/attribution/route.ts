import { NextResponse } from "next/server";
import { authorizeBrandRequest } from "@/lib/auth/guard";
import { getBrandAttribution } from "@/lib/attribution/tracking";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const ATTRIBUTION_MODELS = [
  "first_click",
  "last_click",
  "linear",
  "time_decay",
  "position_based",
] as const;
type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];

/**
 * GET - Get attribution data for a brand
 */
export async function GET(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "viewer");
  if (!authz.ok) return authz.response;
  const { brandId } = authz.context;

  try {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate") || getStartDate(30);
    const endDate = searchParams.get("endDate") || new Date().toISOString().split("T")[0];
    const requestedModel = searchParams.get("model") || "last_click";
    const model: AttributionModel = (ATTRIBUTION_MODELS as readonly string[]).includes(requestedModel)
      ? (requestedModel as AttributionModel)
      : "last_click";

    const attribution = await getBrandAttribution(brandId, startDate, endDate, model);

    return NextResponse.json({
      dateRange: { startDate, endDate },
      model,
      ...attribution,
    });
  } catch (error) {
    console.error("Error fetching attribution data:", error);
    return NextResponse.json({ error: "Failed to fetch attribution data" }, { status: 500 });
  }
}

function getStartDate(daysBack: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysBack);
  return date.toISOString().split("T")[0];
}

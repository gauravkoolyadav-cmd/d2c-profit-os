import { NextResponse } from "next/server";
import { authorizeBrandRequest } from "@/lib/auth/guard";
import { getProfitDashboard, InvalidRangeError } from "@/lib/profit-v1/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET - Profit dashboard for a brand.
 * ?range=today|yesterday|7d|15d|30d  or  ?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD
 */
export async function GET(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "viewer");
  if (!authz.ok) return authz.response;
  const { brandId } = authz.context;

  const { searchParams } = new URL(req.url);
  try {
    const dashboard = await getProfitDashboard(brandId, {
      range: searchParams.get("range"),
      from: searchParams.get("from"),
      to: searchParams.get("to"),
    });
    return NextResponse.json(dashboard, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvalidRangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Error building profit dashboard:", error);
    return NextResponse.json({ error: "Failed to build profit dashboard" }, { status: 500 });
  }
}

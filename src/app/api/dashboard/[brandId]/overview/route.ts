import { NextRequest, NextResponse } from "next/server";
import { authorizeBrandRequest } from "@/lib/auth/guard";
import { getDashboardOverview } from "@/lib/dashboard/overview";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ brandId: string }> }
) {
  const { brandId: requestedBrandId } = await params;
  const authz = await authorizeBrandRequest(requestedBrandId, "viewer");
  if (!authz.ok) return authz.response;
  const { brandId } = authz.context;

  try {
    const data = await getDashboardOverview(brandId);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching dashboard overview:", error);
    return NextResponse.json({ error: "Failed to fetch dashboard overview" }, { status: 500 });
  }
}

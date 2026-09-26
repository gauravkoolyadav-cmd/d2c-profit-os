import { NextResponse } from "next/server";
import { authorizeBrandRequest } from "@/lib/auth/guard";
import {
  calculateProfitMetrics,
  getDailyProfitData,
  getWeeklyProfitData,
  getMonthlyProfitData,
  getPlatformProfitBreakdown,
  type DateRange,
} from "@/lib/profit/calculations";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "viewer");
  if (!authz.ok) return authz.response;
  const { brandId } = authz.context;

  try {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const granularity = searchParams.get("granularity") || "overall"; // overall, daily, weekly, monthly
    const includeBreakdown = searchParams.get("includeBreakdown") === "true";

    // Default to last 30 days if no dates provided
    const defaultEndDate = new Date();
    const defaultStartDate = new Date();
    defaultStartDate.setDate(defaultStartDate.getDate() - 30);

    const dateRange: DateRange = {
      startDate: startDate || defaultStartDate.toISOString().split("T")[0],
      endDate: endDate || defaultEndDate.toISOString().split("T")[0],
    };

    let data;

    switch (granularity) {
      case "daily":
        data = await getDailyProfitData(brandId, dateRange);
        break;
      case "weekly":
        data = await getWeeklyProfitData(brandId, dateRange);
        break;
      case "monthly":
        data = await getMonthlyProfitData(brandId, dateRange);
        break;
      default:
        data = await calculateProfitMetrics(brandId, dateRange);
    }

    const response: Record<string, unknown> = {
      dateRange,
      granularity,
      data,
    };

    if (includeBreakdown) {
      response.breakdown = await getPlatformProfitBreakdown(brandId, dateRange);
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching profit data:", error);
    return NextResponse.json({ error: "Failed to fetch profit data" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { authorizeBrandRequest } from "@/lib/auth/guard";
import {
  generateAnomalyAnalysis,
  generateInsights,
  generateRecommendations,
  generateTrendAnalysis,
  type DateRange,
} from "@/lib/ai/analysis";

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
    const type = searchParams.get("type") || "all"; // all, anomalies, insights, recommendations, trends

    // Default to last 30 days
    const defaultEndDate = new Date();
    const defaultStartDate = new Date();
    defaultStartDate.setDate(defaultStartDate.getDate() - 30);

    const dateRange: DateRange = {
      startDate: startDate || defaultStartDate.toISOString().split("T")[0],
      endDate: endDate || defaultEndDate.toISOString().split("T")[0],
    };

    // Calculate previous period for comparison
    const start = new Date(dateRange.startDate);
    const end = new Date(dateRange.endDate);
    const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    const previousEnd = new Date(start);
    previousEnd.setDate(previousEnd.getDate() - 1);
    const previousStart = new Date(previousEnd);
    previousStart.setDate(previousStart.getDate() - daysDiff + 1);

    const previousDateRange: DateRange = {
      startDate: previousStart.toISOString().split("T")[0],
      endDate: previousEnd.toISOString().split("T")[0],
    };

    const result: Record<string, unknown> = { dateRange };

    if (type === "all" || type === "anomalies") {
      result.anomalies = await generateAnomalyAnalysis(brandId, dateRange);
    }

    if (type === "all" || type === "insights") {
      result.insights = await generateInsights(brandId, dateRange, previousDateRange);
    }

    if (type === "all" || type === "recommendations") {
      result.recommendations = await generateRecommendations(brandId, dateRange);
    }

    if (type === "all" || type === "trends") {
      result.trends = await generateTrendAnalysis(brandId, dateRange);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error generating AI analysis:", error);
    return NextResponse.json({ error: "Failed to generate analysis" }, { status: 500 });
  }
}

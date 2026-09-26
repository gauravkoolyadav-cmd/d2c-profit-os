import { NextResponse } from "next/server";
import { authorizeBrandRequest } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { notificationLogs } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function toBoundedInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/**
 * GET - Get notification logs for a brand
 */
export async function GET(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "viewer");
  if (!authz.ok) return authz.response;
  const { brandId } = authz.context;

  try {
    const { searchParams } = new URL(req.url);
    const page = toBoundedInt(searchParams.get("page"), 1, 1, 10_000);
    const limit = toBoundedInt(searchParams.get("limit"), 20, 1, 100);
    const offset = (page - 1) * limit;

    const logs = await db.query.notificationLogs.findMany({
      where: eq(notificationLogs.brandId, brandId),
      orderBy: [desc(notificationLogs.sentAt)],
      limit,
      offset,
    });

    return NextResponse.json({ logs });
  } catch (error) {
    console.error("Error fetching notification logs:", error);
    return NextResponse.json({ error: "Failed to fetch notification logs" }, { status: 500 });
  }
}

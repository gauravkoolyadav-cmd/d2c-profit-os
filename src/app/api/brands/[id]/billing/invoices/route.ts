import { NextResponse } from "next/server";
import { authorizeBrandRequest } from "@/lib/auth/guard";
import { getBrandInvoices } from "@/lib/payments/management";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET - Get invoices for a brand
 */
export async function GET(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "viewer");
  if (!authz.ok) return authz.response;
  const { brandId } = authz.context;

  try {
    const { searchParams } = new URL(req.url);
    const parsed = parseInt(searchParams.get("limit") || "20", 10);
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 20;

    const invoices = await getBrandInvoices(brandId, limit);

    return NextResponse.json({ invoices });
  } catch (error) {
    console.error("Error fetching invoices:", error);
    return NextResponse.json({ error: "Failed to fetch invoices" }, { status: 500 });
  }
}

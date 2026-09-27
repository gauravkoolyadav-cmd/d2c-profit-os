import { NextResponse } from "next/server";
import { authorizeBrandRequest } from "@/lib/auth/guard";
import { syncMetaForBrand, syncSheetForBrand, syncShopifyForBrand } from "@/lib/profit-v1/jobs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST - "Sync now" for one source (managers and owners).
 * Body: { "source": "sheet" | "meta" | "shopify" }
 */
export async function POST(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "manager");
  if (!authz.ok) return authz.response;
  const { brandId } = authz.context;

  let source: unknown;
  try {
    source = (await req.json())?.source;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    switch (source) {
      case "sheet":
        return NextResponse.json(await syncSheetForBrand(brandId, "manual"));
      case "meta":
        return NextResponse.json(await syncMetaForBrand(brandId, { days: 30 }));
      case "shopify":
        return NextResponse.json(await syncShopifyForBrand(brandId, { hours: 24 * 30 }));
      default:
        return NextResponse.json({ error: "source must be sheet, meta or shopify" }, { status: 400 });
    }
  } catch (error) {
    console.error("Manual sync failed:", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}

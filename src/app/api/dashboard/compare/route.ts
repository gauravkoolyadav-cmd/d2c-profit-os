import { NextRequest, NextResponse } from "next/server";
import { requireBrandRole, requireUser, AuthorizationError, authorizationErrorResponse } from "@/lib/auth/guard";
import { isUuid } from "@/lib/auth/membership";
import { getMultiBrandComparison } from "@/lib/dashboard/overview";

const MIN_BRANDS = 2;
const MAX_BRANDS = 10;

export async function GET(request: NextRequest) {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof AuthorizationError) return authorizationErrorResponse(error);
    throw error;
  }

  const raw = request.nextUrl.searchParams.get("brandIds") ?? "";
  const brandIds = Array.from(
    new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );

  if (brandIds.length < MIN_BRANDS) {
    return NextResponse.json(
      { error: "At least 2 brand IDs required for comparison" },
      { status: 400 }
    );
  }

  if (brandIds.length > MAX_BRANDS) {
    return NextResponse.json(
      { error: `At most ${MAX_BRANDS} brands can be compared` },
      { status: 400 }
    );
  }

  if (!brandIds.every(isUuid)) {
    return NextResponse.json({ error: "Invalid brand ID" }, { status: 400 });
  }

  // The caller must be a member of EVERY requested brand. If any check fails,
  // the whole request is rejected without saying which brand failed, and no
  // metrics are computed for any brand.
  const authorizedBrandIds: string[] = [];
  try {
    for (const brandId of brandIds) {
      const { brandId: authorizedId } = await requireBrandRole(brandId, "viewer");
      authorizedBrandIds.push(authorizedId);
    }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: "One or more brands were not found" },
        { status: error.status === 401 ? 401 : 404 }
      );
    }
    throw error;
  }

  // Default to last 30 days
  const endDate = new Date().toISOString().split("T")[0];
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  try {
    const comparisons = await getMultiBrandComparison(authorizedBrandIds, {
      startDate,
      endDate,
    });
    return NextResponse.json({ comparisons });
  } catch (error) {
    console.error("Error fetching brand comparison:", error);
    return NextResponse.json({ error: "Failed to fetch brand comparison" }, { status: 500 });
  }
}

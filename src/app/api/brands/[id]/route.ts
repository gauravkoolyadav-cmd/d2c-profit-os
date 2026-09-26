import { db } from "@/lib/db";
import { brands } from "@/lib/db/schema";
import { updateBrandSchema } from "@/lib/validators";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { authorizeBrandRequest } from "@/lib/auth/guard";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "viewer");
  if (!authz.ok) return authz.response;
  const { brandId, role } = authz.context;

  try {
    const brand = await db.query.brands.findFirst({
      where: eq(brands.id, brandId),
    });

    if (!brand) {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }

    return NextResponse.json({ ...brand, userRole: role });
  } catch (error) {
    console.error("Error fetching brand:", error);
    return NextResponse.json({ error: "Failed to fetch brand" }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "manager");
  if (!authz.ok) return authz.response;
  const { brandId } = authz.context;

  try {
    const body = await req.json();
    // The id always comes from the authorized URL segment, never from the body.
    const validatedFields = updateBrandSchema.safeParse({ ...body, id: brandId });

    if (!validatedFields.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validatedFields.error.flatten() },
        { status: 400 }
      );
    }

    const { name, timezone, currency, defaultCogsPercentage } = validatedFields.data;

    const [updatedBrand] = await db
      .update(brands)
      .set({
        ...(name !== undefined && { name }),
        ...(timezone !== undefined && { timezone }),
        ...(currency !== undefined && { currency }),
        ...(defaultCogsPercentage !== undefined && { defaultCogsPercentage }),
        updatedAt: new Date(),
      })
      .where(eq(brands.id, brandId))
      .returning();

    return NextResponse.json(updatedBrand);
  } catch (error) {
    console.error("Error updating brand:", error);
    return NextResponse.json({ error: "Failed to update brand" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "owner");
  if (!authz.ok) return authz.response;
  const { brandId } = authz.context;

  try {
    await db.delete(brands).where(eq(brands.id, brandId));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting brand:", error);
    return NextResponse.json({ error: "Failed to delete brand" }, { status: 500 });
  }
}

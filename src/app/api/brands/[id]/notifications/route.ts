import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeBrandRequest } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { notificationPreferences } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const numericString = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => value.length > 0 && value.length <= 10 && Number.isFinite(Number(value)), {
    message: "Must be a number",
  });

const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:MM")
  .nullable();

/**
 * Only these fields may be written by clients. Unknown keys (id, brandId,
 * userId, createdAt, ...) are stripped, so a request can never re-assign a
 * preference row to another brand or user.
 */
const notificationPreferencesInput = z.object({
  telegramChatId: z.string().trim().max(255).nullable().optional(),
  enabled: z.boolean().optional(),
  alertOnLowRoas: z.boolean().optional(),
  alertOnSpendSpike: z.boolean().optional(),
  alertOnRevenueDrop: z.boolean().optional(),
  alertOnNewOrder: z.boolean().optional(),
  alertOnDailySummary: z.boolean().optional(),
  alertOnWeeklySummary: z.boolean().optional(),
  lowRoasThreshold: numericString.optional(),
  spendSpikeThreshold: numericString.optional(),
  revenueDropThreshold: numericString.optional(),
  quietHoursStart: timeOfDay.optional(),
  quietHoursEnd: timeOfDay.optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});

/**
 * GET - Get the current user's notification preferences for a brand
 */
export async function GET(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "viewer");
  if (!authz.ok) return authz.response;
  const { brandId, userId } = authz.context;

  try {
    const prefs = await db.query.notificationPreferences.findFirst({
      where: and(
        eq(notificationPreferences.brandId, brandId),
        eq(notificationPreferences.userId, userId)
      ),
    });

    return NextResponse.json({ preferences: prefs });
  } catch (error) {
    console.error("Error fetching notification preferences:", error);
    return NextResponse.json(
      { error: "Failed to fetch notification preferences" },
      { status: 500 }
    );
  }
}

/**
 * PUT - Update the current user's notification preferences
 */
export async function PUT(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "manager");
  if (!authz.ok) return authz.response;
  const { brandId, userId } = authz.context;

  try {
    const parsed = notificationPreferencesInput.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const input = parsed.data;

    const existing = await db.query.notificationPreferences.findFirst({
      where: and(
        eq(notificationPreferences.brandId, brandId),
        eq(notificationPreferences.userId, userId)
      ),
    });

    if (existing) {
      await db
        .update(notificationPreferences)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(notificationPreferences.id, existing.id),
            eq(notificationPreferences.brandId, brandId),
            eq(notificationPreferences.userId, userId)
          )
        );
    } else {
      await db.insert(notificationPreferences).values({
        ...input,
        brandId,
        userId,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating notification preferences:", error);
    return NextResponse.json(
      { error: "Failed to update notification preferences" },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Remove the current user's notification preferences
 */
export async function DELETE(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "manager");
  if (!authz.ok) return authz.response;
  const { brandId, userId } = authz.context;

  try {
    await db
      .delete(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.brandId, brandId),
          eq(notificationPreferences.userId, userId)
        )
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting notification preferences:", error);
    return NextResponse.json(
      { error: "Failed to delete notification preferences" },
      { status: 500 }
    );
  }
}

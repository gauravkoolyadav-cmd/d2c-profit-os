import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeBrandRequest } from "@/lib/auth/guard";
import { getProfitSettings, saveProfitSettings } from "@/lib/profit-v1/repository";
import { extractSheetId } from "@/lib/profit-v1/sheet-parse";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const RANGE = /^[^!]{1,100}![A-Z]{1,3}\d*(:[A-Z]{1,3}\d*)?$/;

const settingsInput = z.object({
  googleSheetId: z
    .string()
    .trim()
    .max(300)
    .transform((v) => (v === "" ? null : extractSheetId(v)))
    .refine((v) => v === null || /^[a-zA-Z0-9_-]{10,}$/.test(v), "Invalid Google Sheet ID or URL")
    .nullable()
    .optional(),
  configRange: z.string().trim().regex(RANGE, "Use a range like Config!A1:Z1000").optional(),
  mappingRange: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || RANGE.test(v), "Use a range like Mapping!A1:B2000")
    .nullable()
    .optional(),
  defaultProductGstPercent: z.number().min(0).max(100).optional(),
  timezone: z.string().trim().refine(isValidTimeZone, "Unknown timezone").optional(),
});

/** GET - Profit dashboard settings (any member). */
export async function GET(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "viewer");
  if (!authz.ok) return authz.response;

  try {
    return NextResponse.json({ settings: await getProfitSettings(authz.context.brandId) });
  } catch (error) {
    console.error("Error loading profit settings:", error);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

/** PUT - Update settings (managers and owners). */
export async function PUT(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "manager");
  if (!authz.ok) return authz.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = settingsInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    await saveProfitSettings(authz.context.brandId, parsed.data);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving profit settings:", error);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}

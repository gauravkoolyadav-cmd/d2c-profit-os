import { NextResponse } from "next/server";
import { authorizeBrandRequest } from "@/lib/auth/guard";
import { sendTestNotification } from "@/lib/telegram/notifications";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST - Send a test notification
 */
export async function POST(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const authz = await authorizeBrandRequest(id, "manager");
  if (!authz.ok) return authz.response;
  const { brandId } = authz.context;

  try {
    const body = await req.json();
    const chatId = typeof body?.chatId === "string" || typeof body?.chatId === "number"
      ? String(body.chatId).trim()
      : "";

    if (!chatId || chatId.length > 255) {
      return NextResponse.json({ error: "chatId is required" }, { status: 400 });
    }

    const success = await sendTestNotification(brandId, chatId);

    if (success) {
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: "Failed to send test notification" }, { status: 500 });
  } catch (error) {
    console.error("Error sending test notification:", error);
    return NextResponse.json({ error: "Failed to send test notification" }, { status: 500 });
  }
}

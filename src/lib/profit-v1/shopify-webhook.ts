/**
 * Shopify order webhook handler.
 *
 *  1. read the raw body ONCE and verify X-Shopify-Hmac-Sha256 (constant time)
 *  2. find the brand from X-Shopify-Shop-Domain (a shop belongs to exactly one brand)
 *  3. record X-Shopify-Webhook-Id → repeated deliveries are acknowledged, not reprocessed
 *  4. parse + upsert the order (newer Shopify updated_at wins; payment type is sticky)
 *  5. respond 200; on failure respond 500 so Shopify retries (the receipt shows the error)
 */
import { createHmac } from "crypto";
import { NextResponse } from "next/server";
import { safeCompare } from "@/lib/utils/timing-safe";
import { parseShopifyOrder, ShopifyPayloadError } from "./shopify-parse";
import * as repo from "./repository";

const ORDER_TOPICS = new Set([
  "orders/create",
  "orders/updated",
  "orders/paid",
  "orders/cancelled",
  "orders/fulfilled",
  "orders/partially_fulfilled",
  "orders/edited",
]);

export function computeShopifyHmac(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
}

export async function handleShopifyWebhook(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  const topic = req.headers.get("x-shopify-topic");
  const shopDomain = req.headers.get("x-shopify-shop-domain")?.trim().toLowerCase() ?? "";
  const webhookId = req.headers.get("x-shopify-webhook-id") ?? req.headers.get("x-shopify-event-id");

  if (!hmac || !topic || !shopDomain) {
    return NextResponse.json({ error: "Missing Shopify headers" }, { status: 400 });
  }

  const connections = await repo.findShopifyConnectionsByShop(shopDomain);
  if (connections.length > 1) {
    console.error(`Shop ${shopDomain} is linked to ${connections.length} brands; refusing to guess`);
    return NextResponse.json({ error: "Shop is linked to more than one brand" }, { status: 409 });
  }
  const connection = connections[0];

  // Per-store secret (custom apps) or the app-wide secret. Fail closed if neither exists.
  const secret = connection?.metadata?.webhookSecret || process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }
  if (!safeCompare(hmac, computeShopifyHmac(rawBody, secret))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!connection) {
    // Valid Shopify call for a shop we don't know: acknowledge so Shopify stops retrying.
    return NextResponse.json({ ignored: true, reason: "Unknown shop" });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const receipt = await repo.recordWebhookReceipt({
    brandId: connection.brandId,
    shopDomain,
    webhookId: webhookId ?? `no-id:${computeShopifyHmac(rawBody, "receipt")}`,
    topic,
    resourceId: payload.id !== undefined ? String(payload.id) : null,
  });
  if (receipt.previousStatus === "processed" || receipt.previousStatus === "ignored") {
    return NextResponse.json({ duplicate: true });
  }

  try {
    if (topic === "app/uninstalled") {
      await repo.markShopifyUninstalled(connection.brandId, shopDomain);
      await repo.markWebhookReceipt(receipt.id, "processed");
      return NextResponse.json({ success: true });
    }
    if (!ORDER_TOPICS.has(topic)) {
      await repo.markWebhookReceipt(receipt.id, "ignored", `Unhandled topic ${topic}`);
      return NextResponse.json({ ignored: true });
    }

    const settings = await repo.getProfitSettings(connection.brandId);
    const parsed = parseShopifyOrder(payload, settings.timezone);
    const result = await repo.upsertOrder(connection.brandId, shopDomain, parsed);
    await repo.markWebhookReceipt(receipt.id, "processed");
    return NextResponse.json({ success: true, action: result.action });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await repo.markWebhookReceipt(receipt.id, "failed", message.slice(0, 500));
    if (error instanceof ShopifyPayloadError) {
      // A malformed payload will never succeed on retry.
      return NextResponse.json({ error: message }, { status: 422 });
    }
    console.error("Shopify webhook processing failed:", error);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}

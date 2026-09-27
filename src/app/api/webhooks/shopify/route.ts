import { handleShopifyWebhook } from "@/lib/profit-v1/shopify-webhook";

/** Shopify order webhooks → V1 profit dashboard (see src/lib/profit-v1/shopify-webhook.ts). */
export async function POST(req: Request) {
  return handleShopifyWebhook(req);
}

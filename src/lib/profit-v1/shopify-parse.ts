/**
 * Pure parsing of a Shopify order payload (REST/webhook JSON) into our normalized shape.
 * Used by both the webhook and the catch-up sync, so there is one parser.
 */
import { dateInTimeZone } from "./dates";
import { isMetaId } from "./attribution";
import type { OrderStatus, PaymentType, RawAttribution } from "./types";

type Json = Record<string, unknown>;

export interface ParsedOrderItem {
  shopifyLineItemId: string;
  shopifyProductId: string | null;
  shopifyVariantId: string | null;
  productTitle: string;
  variantTitle: string | null;
  lineName: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: number;
}

export interface ParsedOrder {
  shopifyOrderId: string;
  orderNumber: string;
  orderName: string | null;
  orderDate: string;
  shopifyCreatedAt: Date;
  shopifyUpdatedAt: Date;
  currency: string | null;
  totalPrice: number;
  subtotalPrice: number;
  totalDiscounts: number;
  totalTax: number;
  paymentType: PaymentType;
  paymentGateways: string[];
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  orderStatus: OrderStatus;
  cancelledAt: Date | null;
  tags: string | null;
  sourceName: string | null;
  isTest: boolean;
  landingSite: string | null;
  referringSite: string | null;
  attribution: RawAttribution;
  attributionRaw: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
  items: ParsedOrderItem[];
}

const str = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
};
const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Payment type is decided once, from how the customer paid at checkout:
 *  1. "partial" in tags or gateway names, or financial_status = partially_paid → PARTIAL_COD
 *  2. gateway name contains "cash on delivery" / "cod"                          → COD
 *  3. financial_status paid / authorized (/ refunded variants)                   → PREPAID
 *  4. otherwise                                                                  → UNKNOWN (shown as a data issue)
 * The stored value is sticky: later updates (e.g. COD marked paid on delivery) never change it.
 */
export function classifyPaymentType(payload: Json): PaymentType {
  const gateways = asStringArray(payload.payment_gateway_names).map((g) => g.toLowerCase());
  const tags = (str(payload.tags) ?? "").toLowerCase();
  const financial = (str(payload.financial_status) ?? "").toLowerCase();

  if (/\bpartial/.test(tags) || gateways.some((g) => g.includes("partial")) || financial === "partially_paid") {
    return "PARTIAL_COD";
  }
  if (gateways.some((g) => g.includes("cash on delivery") || /\bcod\b/.test(g))) return "COD";
  if (["paid", "authorized", "partially_refunded", "refunded"].includes(financial)) return "PREPAID";
  return "UNKNOWN";
}

/**
 *  cancelled_at set                       → CANCELLED
 *  tag "RTO" / "return to origin"          → RTO   (courier apps / ops team tag RTO orders)
 *  any fulfillment shipment_status = delivered, or tag "delivered" → DELIVERED
 *  otherwise                               → PENDING
 */
export function deriveOrderStatus(payload: Json): OrderStatus {
  if (str(payload.cancelled_at)) return "CANCELLED";
  const tags = (str(payload.tags) ?? "").toLowerCase();
  if (/\brto\b/.test(tags) || tags.includes("return to origin")) return "RTO";
  const fulfillments = Array.isArray(payload.fulfillments) ? (payload.fulfillments as Json[]) : [];
  if (fulfillments.some((f) => str(f?.shipment_status)?.toLowerCase() === "delivered") || /\bdelivered\b/.test(tags)) {
    return "DELIVERED";
  }
  return "PENDING";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

function queryParams(url: string | null): URLSearchParams {
  if (!url) return new URLSearchParams();
  try {
    return new URL(url, "https://shop.invalid").searchParams;
  } catch {
    const q = url.indexOf("?");
    return new URLSearchParams(q >= 0 ? url.slice(q + 1) : "");
  }
}

const AD_ID_KEYS = ["meta_ad_id", "fb_ad_id", "ad_id", "adid"];
const ADSET_ID_KEYS = ["meta_adset_id", "fb_adset_id", "adset_id"];
const CAMPAIGN_ID_KEYS = ["meta_campaign_id", "fb_campaign_id", "campaign_id"];

/**
 * UTM + Meta ids from note attributes (checkout apps often store them there) first,
 * then the landing-site URL. Numeric utm_content / utm_campaign / utm_term are treated
 * as Meta ad / campaign / ad set ids.
 */
export function extractAttribution(payload: Json): { attribution: RawAttribution; raw: Record<string, unknown> } {
  const noteAttributes: Record<string, string> = {};
  if (Array.isArray(payload.note_attributes)) {
    for (const entry of payload.note_attributes as Json[]) {
      const name = str(entry?.name)?.toLowerCase();
      const value = str(entry?.value);
      if (name && value) noteAttributes[name] = value;
    }
  }
  const landing = queryParams(str(payload.landing_site));
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      if (noteAttributes[key]) return noteAttributes[key];
    }
    for (const key of keys) {
      const value = str(landing.get(key));
      if (value) return value;
    }
    return null;
  };

  const utmCampaign = pick("utm_campaign");
  const utmContent = pick("utm_content");
  const utmTerm = pick("utm_term");
  const utmId = pick("utm_id");
  const attribution: RawAttribution = {
    utmSource: pick("utm_source"),
    utmMedium: pick("utm_medium"),
    utmCampaign,
    utmContent,
    utmTerm,
    utmId,
    metaAdId: pick(...AD_ID_KEYS) ?? (isMetaId(utmContent) ? utmContent : null),
    metaAdsetId: pick(...ADSET_ID_KEYS) ?? (isMetaId(utmTerm) ? utmTerm : null),
    metaCampaignId: pick(...CAMPAIGN_ID_KEYS) ?? (isMetaId(utmCampaign) ? utmCampaign : isMetaId(utmId) ? utmId : null),
  };

  return {
    attribution,
    raw: {
      landing_site: str(payload.landing_site),
      referring_site: str(payload.referring_site),
      source_name: str(payload.source_name),
      note_attributes: noteAttributes,
      fbclid: pick("fbclid") ?? null,
      fbclid_present: Boolean(pick("fbclid")),
    },
  };
}

const PII_KEYS = [
  "customer",
  "email",
  "contact_email",
  "phone",
  "billing_address",
  "browser_ip",
  "client_details",
  "note",
  "customer_locale",
];

/** Keep the payload for debugging/reconciliation, minus customer personal data. */
export function sanitizePayload(payload: Json): Record<string, unknown> {
  const copy: Json = { ...payload };
  for (const key of PII_KEYS) delete copy[key];
  const shipping = payload.shipping_address as Json | undefined;
  if (shipping && typeof shipping === "object") {
    copy.shipping_address = {
      city: shipping.city ?? null,
      province: shipping.province ?? null,
      zip: shipping.zip ?? null,
      country_code: shipping.country_code ?? null,
    };
  }
  return copy;
}

export class ShopifyPayloadError extends Error {}

export function parseShopifyOrder(payload: Json, timeZone: string): ParsedOrder {
  const id = str(payload.id);
  const createdAt = str(payload.created_at);
  if (!id || !createdAt) throw new ShopifyPayloadError("Order payload is missing id or created_at");

  const created = new Date(createdAt);
  const updated = new Date(str(payload.updated_at) ?? createdAt);
  if (Number.isNaN(created.getTime())) throw new ShopifyPayloadError("Invalid created_at");

  const { attribution, raw } = extractAttribution(payload);
  const lineItems = Array.isArray(payload.line_items) ? (payload.line_items as Json[]) : [];

  return {
    shopifyOrderId: id,
    orderNumber: str(payload.order_number) ?? str(payload.name) ?? id,
    orderName: str(payload.name),
    orderDate: dateInTimeZone(created, timeZone),
    shopifyCreatedAt: created,
    shopifyUpdatedAt: Number.isNaN(updated.getTime()) ? created : updated,
    currency: str(payload.currency),
    totalPrice: num(payload.total_price),
    subtotalPrice: num(payload.subtotal_price),
    totalDiscounts: num(payload.total_discounts),
    totalTax: num(payload.total_tax),
    paymentType: classifyPaymentType(payload),
    paymentGateways: asStringArray(payload.payment_gateway_names),
    financialStatus: str(payload.financial_status),
    fulfillmentStatus: str(payload.fulfillment_status),
    orderStatus: deriveOrderStatus(payload),
    cancelledAt: str(payload.cancelled_at) ? new Date(String(payload.cancelled_at)) : null,
    tags: str(payload.tags),
    sourceName: str(payload.source_name),
    isTest: payload.test === true,
    landingSite: str(payload.landing_site),
    referringSite: str(payload.referring_site),
    attribution,
    attributionRaw: raw,
    rawPayload: sanitizePayload(payload),
    items: lineItems
      .filter((item) => str(item?.id))
      .map((item) => ({
        shopifyLineItemId: String(item.id),
        shopifyProductId: str(item.product_id),
        shopifyVariantId: str(item.variant_id),
        productTitle: str(item.title) ?? str(item.name) ?? "Unknown product",
        variantTitle: str(item.variant_title),
        lineName: str(item.name),
        sku: str(item.sku),
        quantity: Math.max(0, Math.trunc(num(item.quantity))),
        unitPrice: num(item.price),
      })),
  };
}

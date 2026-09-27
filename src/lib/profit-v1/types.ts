/**
 * Plain data types used by the V1 profit engine.
 * The engine never touches the database; the repository converts DB rows into these.
 */

export type PaymentType = "PREPAID" | "COD" | "PARTIAL_COD" | "UNKNOWN";
export type OrderStatus = "PENDING" | "DELIVERED" | "RTO" | "CANCELLED";

/** One Google Sheet row (current business configuration). Percentages are 0–100. */
export interface ShoeConfig {
  shoeName: string;
  normalizedName: string;
  prepaidSellingPrice: number;
  codOrPartialSellingPrice: number;
  productCost: number;
  prepaidShippingCost: number;
  codShippingCost: number;
  prepaidDeliveryPercent: number;
  codOrPartialDeliveryPercent: number;
  /** null = use the brand default GST % */
  gstPercent: number | null;
}

export interface NameMapping {
  normalizedShopifyName: string;
  normalizedShoeName: string;
}

export interface EngineOrderItem {
  productTitle: string;
  variantTitle: string | null;
  lineName: string | null;
  quantity: number;
  /** Price actually charged by Shopify (reference only; profit uses the sheet price). */
  unitPrice: number;
}

export interface RawAttribution {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  utmId: string | null;
  metaCampaignId: string | null;
  metaAdsetId: string | null;
  metaAdId: string | null;
}

export interface EngineOrder {
  id: string;
  orderNumber: string;
  /** Business date YYYY-MM-DD */
  orderDate: string;
  createdAt: string;
  paymentType: PaymentType;
  orderStatus: OrderStatus;
  /** Customer-paid order total from Shopify (reference only). */
  totalPrice: number;
  items: EngineOrderItem[];
  attribution: RawAttribution;
}

/** A Meta ad ("creative") with its hierarchy. */
export interface MetaCreative {
  adId: string;
  adName: string;
  adsetId: string | null;
  adsetName: string | null;
  campaignId: string | null;
  campaignName: string | null;
}

export interface MetaCampaign {
  campaignId: string;
  campaignName: string;
}

/** Meta spend for one ad on one day (spend excludes GST, as Meta reports it). */
export interface SpendRow {
  date: string;
  campaignId: string;
  campaignName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  adId: string;
  adName: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
}

export interface DateRange {
  from: string;
  to: string;
}

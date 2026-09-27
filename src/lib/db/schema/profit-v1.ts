/**
 * V1 Simple Profit Dashboard tables.
 *
 * RAW data (orders, order_items, ad_spend_daily, ad_creatives) is stored as
 * received. BUSINESS CONFIGURATION (shoe_profit_config, shoe_name_mappings,
 * profit_settings) comes from the Google Sheet / settings screen. PROFIT is
 * never stored: it is calculated on every read by src/lib/profit-v1/engine.ts.
 *
 * Every table carries brand_id (tenant boundary).
 */
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { brands } from "./core";

export const PAYMENT_TYPES = ["PREPAID", "COD", "PARTIAL_COD", "UNKNOWN"] as const;
export type PaymentTypeValue = (typeof PAYMENT_TYPES)[number];

export const ORDER_STATUSES = ["PENDING", "DELIVERED", "RTO", "CANCELLED"] as const;
export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

const timestamps = {
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
};

// ── Configuration ────────────────────────────────────────────────────────

/** One row per brand: where the Google Sheet is and central settings. */
export const profitSettings = pgTable("profit_settings", {
  brandId: uuid("brand_id")
    .primaryKey()
    .references(() => brands.id, { onDelete: "cascade" }),
  googleSheetId: text("google_sheet_id"),
  /** A1 range of the shoe configuration tab (first row = headers). */
  configRange: text("config_range").notNull().default("Config!A1:Z1000"),
  /** Optional A1 range of the "Shopify product name → shoe name" tab. */
  mappingRange: text("mapping_range"),
  /** Product GST % used when a shoe row has no GST % of its own. 0 = prices treated as-is. */
  defaultProductGstPercent: numeric("default_product_gst_percent", { precision: 5, scale: 2 })
    .notNull()
    .default("0"),
  /** Timezone used to decide an order's business date. */
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  ...timestamps,
});

/** Current economics per shoe, synced from the Google Sheet. One row per shoe name. */
export const shoeProfitConfig = pgTable(
  "shoe_profit_config",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    shoeName: text("shoe_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    prepaidSellingPrice: numeric("prepaid_selling_price", { precision: 12, scale: 2 }).notNull(),
    codOrPartialSellingPrice: numeric("cod_or_partial_selling_price", { precision: 12, scale: 2 }).notNull(),
    productCost: numeric("product_cost", { precision: 12, scale: 2 }).notNull(),
    prepaidShippingCost: numeric("prepaid_shipping_cost", { precision: 12, scale: 2 }).notNull(),
    codShippingCost: numeric("cod_shipping_cost", { precision: 12, scale: 2 }).notNull(),
    /** 0–100 */
    prepaidDeliveryPercent: numeric("prepaid_delivery_percent", { precision: 5, scale: 2 }).notNull(),
    /** 0–100 */
    codOrPartialDeliveryPercent: numeric("cod_or_partial_delivery_percent", { precision: 5, scale: 2 }).notNull(),
    /** Optional per-shoe product GST %; null = use profit_settings default. */
    gstPercent: numeric("gst_percent", { precision: 5, scale: 2 }),
    sheetRow: integer("sheet_row"),
    /** false when the shoe no longer appears in the sheet. */
    isActive: boolean("is_active").notNull().default(true),
    syncedAt: timestamp("synced_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    unique("shoe_profit_config_brand_name_unique").on(table.brandId, table.normalizedName),
    index("shoe_profit_config_brand_idx").on(table.brandId),
  ]
);

/** Manual "Shopify product name → shoe name" mapping (optional sheet tab). */
export const shoeNameMappings = pgTable(
  "shoe_name_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    shopifyName: text("shopify_name").notNull(),
    normalizedShopifyName: text("normalized_shopify_name").notNull(),
    shoeName: text("shoe_name").notNull(),
    normalizedShoeName: text("normalized_shoe_name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    syncedAt: timestamp("synced_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    unique("shoe_name_mappings_brand_name_unique").on(table.brandId, table.normalizedShopifyName),
    index("shoe_name_mappings_brand_idx").on(table.brandId),
  ]
);

/** Log of every Google Sheet sync, including rejected rows. */
export const shoeConfigSyncRuns = pgTable(
  "shoe_config_sync_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["running", "success", "partial", "failed"] }).notNull(),
    triggeredBy: text("triggered_by", { enum: ["manual", "cron"] }).notNull(),
    rowsRead: integer("rows_read").notNull().default(0),
    rowsApplied: integer("rows_applied").notNull().default(0),
    rowsRejected: integer("rows_rejected").notNull().default(0),
    mappingsApplied: integer("mappings_applied").notNull().default(0),
    errors: jsonb("errors").$type<Array<{ tab: string; row: number; shoeName?: string; message: string }>>(),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { mode: "date", withTimezone: true }),
  },
  (table) => [index("shoe_config_sync_runs_brand_idx").on(table.brandId, table.startedAt)]
);

// ── Raw Shopify data ─────────────────────────────────────────────────────

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    shopDomain: text("shop_domain").notNull(),
    shopifyOrderId: text("shopify_order_id").notNull(),
    orderNumber: text("order_number").notNull(),
    orderName: text("order_name"),
    /** Business date in profit_settings.timezone (YYYY-MM-DD). */
    orderDate: date("order_date", { mode: "string" }).notNull(),
    shopifyCreatedAt: timestamp("shopify_created_at", { mode: "date", withTimezone: true }).notNull(),
    shopifyUpdatedAt: timestamp("shopify_updated_at", { mode: "date", withTimezone: true }).notNull(),
    currency: text("currency"),
    totalPrice: numeric("total_price", { precision: 12, scale: 2 }).notNull().default("0"),
    subtotalPrice: numeric("subtotal_price", { precision: 12, scale: 2 }).notNull().default("0"),
    totalDiscounts: numeric("total_discounts", { precision: 12, scale: 2 }).notNull().default("0"),
    totalTax: numeric("total_tax", { precision: 12, scale: 2 }).notNull().default("0"),
    paymentType: text("payment_type", { enum: PAYMENT_TYPES }).notNull(),
    paymentGateways: text("payment_gateways").array().notNull().default([]),
    financialStatus: text("financial_status"),
    fulfillmentStatus: text("fulfillment_status"),
    orderStatus: text("order_status", { enum: ORDER_STATUSES }).notNull(),
    cancelledAt: timestamp("cancelled_at", { mode: "date", withTimezone: true }),
    tags: text("tags"),
    sourceName: text("source_name"),
    isTest: boolean("is_test").notNull().default(false),
    // Attribution exactly as it came with the order
    landingSite: text("landing_site"),
    referringSite: text("referring_site"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    utmTerm: text("utm_term"),
    utmId: text("utm_id"),
    metaCampaignId: text("meta_campaign_id"),
    metaAdsetId: text("meta_adset_id"),
    metaAdId: text("meta_ad_id"),
    attributionRaw: jsonb("attribution_raw").$type<Record<string, unknown>>(),
    /** Shopify payload with customer PII removed, for debugging/reconciliation. */
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    unique("orders_brand_shopify_order_unique").on(table.brandId, table.shopifyOrderId),
    index("orders_brand_date_idx").on(table.brandId, table.orderDate),
  ]
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    shopifyLineItemId: text("shopify_line_item_id").notNull(),
    shopifyProductId: text("shopify_product_id"),
    shopifyVariantId: text("shopify_variant_id"),
    productTitle: text("product_title").notNull(),
    variantTitle: text("variant_title"),
    lineName: text("line_name"),
    sku: text("sku"),
    quantity: integer("quantity").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull().default("0"),
    ...timestamps,
  },
  (table) => [
    unique("order_items_order_line_unique").on(table.orderId, table.shopifyLineItemId),
    index("order_items_brand_order_idx").on(table.brandId, table.orderId),
  ]
);

/** Every Shopify webhook delivery (idempotency + failure visibility). */
export const webhookReceipts = pgTable(
  "webhook_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("shopify"),
    shopDomain: text("shop_domain").notNull(),
    webhookId: text("webhook_id").notNull(),
    topic: text("topic").notNull(),
    resourceId: text("resource_id"),
    status: text("status", { enum: ["received", "processed", "failed", "ignored"] }).notNull(),
    error: text("error"),
    attempts: integer("attempts").notNull().default(1),
    receivedAt: timestamp("received_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { mode: "date", withTimezone: true }),
  },
  (table) => [
    unique("webhook_receipts_shop_webhook_unique").on(table.shopDomain, table.webhookId),
    index("webhook_receipts_brand_idx").on(table.brandId, table.receivedAt),
  ]
);

// ── Raw Meta data (campaigns reuse the existing ad_campaigns table) ────────

/** Meta ad = "creative" in the dashboard. */
export const adCreatives = pgTable(
  "ad_creatives",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    platform: text("platform").notNull().default("meta"),
    adAccountId: text("ad_account_id").notNull(),
    adId: text("ad_id").notNull(),
    adName: text("ad_name").notNull(),
    adsetId: text("adset_id"),
    adsetName: text("adset_name"),
    campaignId: text("campaign_id"),
    campaignName: text("campaign_name"),
    creativeId: text("creative_id"),
    creativeName: text("creative_name"),
    thumbnailUrl: text("thumbnail_url"),
    status: text("status"),
    ...timestamps,
  },
  (table) => [
    unique("ad_creatives_brand_platform_ad_unique").on(table.brandId, table.platform, table.adId),
    index("ad_creatives_brand_campaign_idx").on(table.brandId, table.campaignId),
  ]
);

/** Daily spend per ad (creative). Spend is stored exactly as Meta reports it (excl. GST). */
export const adSpendDaily = pgTable(
  "ad_spend_daily",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    platform: text("platform").notNull().default("meta"),
    adAccountId: text("ad_account_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    campaignId: text("campaign_id").notNull(),
    campaignName: text("campaign_name"),
    adsetId: text("adset_id"),
    adsetName: text("adset_name"),
    adId: text("ad_id").notNull(),
    adName: text("ad_name"),
    spend: numeric("spend", { precision: 12, scale: 2 }).notNull().default("0"),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    purchases: integer("purchases").notNull().default(0),
    fetchedAt: timestamp("fetched_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("ad_spend_daily_brand_platform_ad_date_unique").on(
      table.brandId,
      table.platform,
      table.adId,
      table.date
    ),
    index("ad_spend_daily_brand_date_idx").on(table.brandId, table.date),
  ]
);

/**
 * All database access for the V1 profit dashboard. Every brand-scoped query filters by brandId.
 */
import { and, desc, eq, gte, isNotNull, lte, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  adCampaigns,
  adCreatives,
  adSpendDaily,
  orderItems,
  orders,
  platformConnections,
  profitSettings,
  shoeConfigSyncRuns,
  shoeNameMappings,
  shoeProfitConfig,
  syncLogs,
  webhookReceipts,
} from "@/lib/db/schema";
import type { ParsedOrder } from "./shopify-parse";
import type { EngineOrder, MetaCampaign, MetaCreative, NameMapping, ShoeConfig, SpendRow } from "./types";

const toNumber = (value: unknown): number => {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
};
const toNullableNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : toNumber(value);
const money = (value: number) => value.toFixed(2);

function chunk<T>(rows: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

// ── Settings ──────────────────────────────────────────────────────────────
export interface ProfitSettingsView {
  googleSheetId: string | null;
  configRange: string;
  mappingRange: string | null;
  defaultProductGstPercent: number;
  timezone: string;
}

export const DEFAULT_SETTINGS: ProfitSettingsView = {
  googleSheetId: null,
  configRange: "Config!A1:Z1000",
  mappingRange: null,
  defaultProductGstPercent: 0,
  timezone: "Asia/Kolkata",
};

export async function getProfitSettings(brandId: string): Promise<ProfitSettingsView> {
  const rows = await db.select().from(profitSettings).where(eq(profitSettings.brandId, brandId)).limit(1);
  const row = rows[0];
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    googleSheetId: row.googleSheetId ?? null,
    configRange: row.configRange || DEFAULT_SETTINGS.configRange,
    mappingRange: row.mappingRange ?? null,
    defaultProductGstPercent: toNumber(row.defaultProductGstPercent),
    timezone: row.timezone || DEFAULT_SETTINGS.timezone,
  };
}

export async function saveProfitSettings(brandId: string, input: Partial<ProfitSettingsView>): Promise<void> {
  const values = {
    ...(input.googleSheetId !== undefined && { googleSheetId: input.googleSheetId }),
    ...(input.configRange !== undefined && { configRange: input.configRange }),
    ...(input.mappingRange !== undefined && { mappingRange: input.mappingRange }),
    ...(input.defaultProductGstPercent !== undefined && {
      defaultProductGstPercent: input.defaultProductGstPercent.toFixed(2),
    }),
    ...(input.timezone !== undefined && { timezone: input.timezone }),
  };
  await db
    .insert(profitSettings)
    .values({ brandId, ...values })
    .onConflictDoUpdate({ target: profitSettings.brandId, set: { ...values, updatedAt: new Date() } });
}

// ── Configuration (Google Sheet) ─────────────────────────────────────────
export async function loadShoeConfigs(brandId: string): Promise<ShoeConfig[]> {
  const rows = await db
    .select()
    .from(shoeProfitConfig)
    .where(and(eq(shoeProfitConfig.brandId, brandId), eq(shoeProfitConfig.isActive, true)));
  return rows.map((row) => ({
    shoeName: row.shoeName,
    normalizedName: row.normalizedName,
    prepaidSellingPrice: toNumber(row.prepaidSellingPrice),
    codOrPartialSellingPrice: toNumber(row.codOrPartialSellingPrice),
    productCost: toNumber(row.productCost),
    prepaidShippingCost: toNumber(row.prepaidShippingCost),
    codShippingCost: toNumber(row.codShippingCost),
    prepaidDeliveryPercent: toNumber(row.prepaidDeliveryPercent),
    codOrPartialDeliveryPercent: toNumber(row.codOrPartialDeliveryPercent),
    gstPercent: toNullableNumber(row.gstPercent),
  }));
}

export async function loadNameMappings(brandId: string): Promise<NameMapping[]> {
  const rows = await db
    .select({
      normalizedShopifyName: shoeNameMappings.normalizedShopifyName,
      normalizedShoeName: shoeNameMappings.normalizedShoeName,
    })
    .from(shoeNameMappings)
    .where(and(eq(shoeNameMappings.brandId, brandId), eq(shoeNameMappings.isActive, true)));
  return rows;
}

export async function applyShoeConfig(
  brandId: string,
  input: {
    configs: ShoeConfig[];
    configSheetRows: Map<string, number>;
    namesInSheet: string[];
    mappings: Array<NameMapping & { shopifyName: string; shoeName: string }> | null;
  }
): Promise<void> {
  const now = new Date();
  for (const part of chunk(input.configs)) {
    await db
      .insert(shoeProfitConfig)
      .values(
        part.map((c) => ({
          brandId,
          shoeName: c.shoeName,
          normalizedName: c.normalizedName,
          prepaidSellingPrice: money(c.prepaidSellingPrice),
          codOrPartialSellingPrice: money(c.codOrPartialSellingPrice),
          productCost: money(c.productCost),
          prepaidShippingCost: money(c.prepaidShippingCost),
          codShippingCost: money(c.codShippingCost),
          prepaidDeliveryPercent: money(c.prepaidDeliveryPercent),
          codOrPartialDeliveryPercent: money(c.codOrPartialDeliveryPercent),
          gstPercent: c.gstPercent === null ? null : money(c.gstPercent),
          sheetRow: input.configSheetRows.get(c.normalizedName) ?? null,
          isActive: true,
          syncedAt: now,
        }))
      )
      .onConflictDoUpdate({
        target: [shoeProfitConfig.brandId, shoeProfitConfig.normalizedName],
        set: {
          shoeName: sql`excluded.shoe_name`,
          prepaidSellingPrice: sql`excluded.prepaid_selling_price`,
          codOrPartialSellingPrice: sql`excluded.cod_or_partial_selling_price`,
          productCost: sql`excluded.product_cost`,
          prepaidShippingCost: sql`excluded.prepaid_shipping_cost`,
          codShippingCost: sql`excluded.cod_shipping_cost`,
          prepaidDeliveryPercent: sql`excluded.prepaid_delivery_percent`,
          codOrPartialDeliveryPercent: sql`excluded.cod_or_partial_delivery_percent`,
          gstPercent: sql`excluded.gst_percent`,
          sheetRow: sql`excluded.sheet_row`,
          isActive: true,
          syncedAt: now,
          updatedAt: now,
        },
      });
  }
  // Shoes removed from the sheet stop being used. Shoes whose row is present but invalid keep
  // their last good values (they are still listed in namesInSheet).
  if (input.namesInSheet.length > 0) {
    await db
      .update(shoeProfitConfig)
      .set({ isActive: false, updatedAt: now })
      .where(and(eq(shoeProfitConfig.brandId, brandId), notInArray(shoeProfitConfig.normalizedName, input.namesInSheet)));
  }

  if (input.mappings) {
    for (const part of chunk(input.mappings)) {
      await db
        .insert(shoeNameMappings)
        .values(part.map((m) => ({ brandId, ...m, isActive: true, syncedAt: now })))
        .onConflictDoUpdate({
          target: [shoeNameMappings.brandId, shoeNameMappings.normalizedShopifyName],
          set: {
            shopifyName: sql`excluded.shopify_name`,
            shoeName: sql`excluded.shoe_name`,
            normalizedShoeName: sql`excluded.normalized_shoe_name`,
            isActive: true,
            syncedAt: now,
            updatedAt: now,
          },
        });
    }
    const keep = input.mappings.map((m) => m.normalizedShopifyName);
    await db
      .update(shoeNameMappings)
      .set({ isActive: false, updatedAt: now })
      .where(
        keep.length > 0
          ? and(eq(shoeNameMappings.brandId, brandId), notInArray(shoeNameMappings.normalizedShopifyName, keep))
          : eq(shoeNameMappings.brandId, brandId)
      );
  }
}

export async function startConfigSyncRun(brandId: string, triggeredBy: "manual" | "cron"): Promise<string> {
  const [row] = await db
    .insert(shoeConfigSyncRuns)
    .values({ brandId, status: "running", triggeredBy })
    .returning({ id: shoeConfigSyncRuns.id });
  return row.id;
}

export async function finishConfigSyncRun(
  brandId: string,
  runId: string,
  patch: Partial<typeof shoeConfigSyncRuns.$inferInsert>
): Promise<void> {
  await db
    .update(shoeConfigSyncRuns)
    .set({ ...patch, finishedAt: new Date() })
    .where(and(eq(shoeConfigSyncRuns.id, runId), eq(shoeConfigSyncRuns.brandId, brandId)));
}

export async function latestConfigSyncRun(brandId: string) {
  const rows = await db
    .select()
    .from(shoeConfigSyncRuns)
    .where(eq(shoeConfigSyncRuns.brandId, brandId))
    .orderBy(desc(shoeConfigSyncRuns.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

// ── Orders ────────────────────────────────────────────────────────────────
export async function upsertOrder(
  brandId: string,
  shopDomain: string,
  parsed: ParsedOrder
): Promise<{ orderId: string; action: "inserted" | "updated" | "skipped_stale" }> {
  const existing = (
    await db
      .select({ id: orders.id, paymentType: orders.paymentType, shopifyUpdatedAt: orders.shopifyUpdatedAt })
      .from(orders)
      .where(and(eq(orders.brandId, brandId), eq(orders.shopifyOrderId, parsed.shopifyOrderId)))
      .limit(1)
  )[0];

  // Out-of-order / repeated deliveries never overwrite newer data.
  if (existing && existing.shopifyUpdatedAt && existing.shopifyUpdatedAt > parsed.shopifyUpdatedAt) {
    return { orderId: existing.id, action: "skipped_stale" };
  }

  // Payment type is sticky: once known it never changes (e.g. COD later marked paid).
  const paymentType =
    existing &&
    existing.paymentType !== "UNKNOWN" &&
    // A COD order that later becomes a partial-prepaid COD may upgrade (same economics).
    !(existing.paymentType === "COD" && parsed.paymentType === "PARTIAL_COD")
      ? existing.paymentType
      : parsed.paymentType;

  const values = {
    brandId,
    shopDomain,
    shopifyOrderId: parsed.shopifyOrderId,
    orderNumber: parsed.orderNumber,
    orderName: parsed.orderName,
    orderDate: parsed.orderDate,
    shopifyCreatedAt: parsed.shopifyCreatedAt,
    shopifyUpdatedAt: parsed.shopifyUpdatedAt,
    currency: parsed.currency,
    totalPrice: money(parsed.totalPrice),
    subtotalPrice: money(parsed.subtotalPrice),
    totalDiscounts: money(parsed.totalDiscounts),
    totalTax: money(parsed.totalTax),
    paymentType,
    paymentGateways: parsed.paymentGateways,
    financialStatus: parsed.financialStatus,
    fulfillmentStatus: parsed.fulfillmentStatus,
    orderStatus: parsed.orderStatus,
    cancelledAt: parsed.cancelledAt,
    tags: parsed.tags,
    sourceName: parsed.sourceName,
    isTest: parsed.isTest,
    landingSite: parsed.landingSite,
    referringSite: parsed.referringSite,
    utmSource: parsed.attribution.utmSource,
    utmMedium: parsed.attribution.utmMedium,
    utmCampaign: parsed.attribution.utmCampaign,
    utmContent: parsed.attribution.utmContent,
    utmTerm: parsed.attribution.utmTerm,
    utmId: parsed.attribution.utmId,
    metaCampaignId: parsed.attribution.metaCampaignId,
    metaAdsetId: parsed.attribution.metaAdsetId,
    metaAdId: parsed.attribution.metaAdId,
    attributionRaw: parsed.attributionRaw,
    rawPayload: parsed.rawPayload,
  };
  const { brandId: _b, shopifyOrderId: _s, ...updatable } = values;
  void _b;
  void _s;

  const [row] = await db
    .insert(orders)
    .values(values)
    .onConflictDoUpdate({
      target: [orders.brandId, orders.shopifyOrderId],
      set: { ...updatable, updatedAt: new Date() },
    })
    .returning({ id: orders.id });

  if (parsed.items.length > 0) {
    await db
      .insert(orderItems)
      .values(
        parsed.items.map((item) => ({
          brandId,
          orderId: row.id,
          shopifyLineItemId: item.shopifyLineItemId,
          shopifyProductId: item.shopifyProductId,
          shopifyVariantId: item.shopifyVariantId,
          productTitle: item.productTitle,
          variantTitle: item.variantTitle,
          lineName: item.lineName,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: money(item.unitPrice),
        }))
      )
      .onConflictDoUpdate({
        target: [orderItems.orderId, orderItems.shopifyLineItemId],
        set: {
          productTitle: sql`excluded.product_title`,
          variantTitle: sql`excluded.variant_title`,
          lineName: sql`excluded.line_name`,
          sku: sql`excluded.sku`,
          quantity: sql`excluded.quantity`,
          unitPrice: sql`excluded.unit_price`,
          updatedAt: new Date(),
        },
      });
  }

  return { orderId: row.id, action: existing ? "updated" : "inserted" };
}

export async function loadOrdersForRange(brandId: string, from: string, to: string): Promise<EngineOrder[]> {
  const orderRows = await db
    .select()
    .from(orders)
    .where(
      and(eq(orders.brandId, brandId), gte(orders.orderDate, from), lte(orders.orderDate, to), eq(orders.isTest, false))
    );
  if (orderRows.length === 0) return [];

  const itemRows = await db
    .select({
      orderId: orderItems.orderId,
      productTitle: orderItems.productTitle,
      variantTitle: orderItems.variantTitle,
      lineName: orderItems.lineName,
      quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice,
    })
    .from(orderItems)
    .innerJoin(orders, and(eq(orders.id, orderItems.orderId), eq(orders.brandId, orderItems.brandId)))
    .where(
      and(eq(orderItems.brandId, brandId), gte(orders.orderDate, from), lte(orders.orderDate, to), eq(orders.isTest, false))
    );

  const itemsByOrder = new Map<string, EngineOrder["items"]>();
  for (const item of itemRows) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push({
      productTitle: item.productTitle,
      variantTitle: item.variantTitle,
      lineName: item.lineName,
      quantity: item.quantity,
      unitPrice: toNumber(item.unitPrice),
    });
    itemsByOrder.set(item.orderId, list);
  }

  return orderRows.map((row) => ({
    id: row.id,
    orderNumber: row.orderName ?? row.orderNumber,
    orderDate: row.orderDate,
    createdAt: row.shopifyCreatedAt.toISOString(),
    paymentType: row.paymentType,
    orderStatus: row.orderStatus,
    totalPrice: toNumber(row.totalPrice),
    items: itemsByOrder.get(row.id) ?? [],
    attribution: {
      utmSource: row.utmSource,
      utmMedium: row.utmMedium,
      utmCampaign: row.utmCampaign,
      utmContent: row.utmContent,
      utmTerm: row.utmTerm,
      utmId: row.utmId,
      metaCampaignId: row.metaCampaignId,
      metaAdsetId: row.metaAdsetId,
      metaAdId: row.metaAdId,
    },
  }));
}

// ── Meta ──────────────────────────────────────────────────────────────────
export async function loadSpendForRange(brandId: string, from: string, to: string): Promise<SpendRow[]> {
  const rows = await db
    .select()
    .from(adSpendDaily)
    .where(and(eq(adSpendDaily.brandId, brandId), gte(adSpendDaily.date, from), lte(adSpendDaily.date, to)));
  return rows.map((row) => ({
    date: row.date,
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    adsetId: row.adsetId,
    adsetName: row.adsetName,
    adId: row.adId,
    adName: row.adName,
    spend: toNumber(row.spend),
    impressions: row.impressions,
    clicks: row.clicks,
    purchases: row.purchases,
  }));
}

export async function loadMetaEntities(brandId: string): Promise<{ creatives: MetaCreative[]; campaigns: MetaCampaign[] }> {
  const [creativeRows, campaignRows] = await Promise.all([
    db.select().from(adCreatives).where(eq(adCreatives.brandId, brandId)),
    db
      .select({ campaignId: adCampaigns.platformCampaignId, campaignName: adCampaigns.name })
      .from(adCampaigns)
      .where(and(eq(adCampaigns.brandId, brandId), eq(adCampaigns.platform, "meta"))),
  ]);
  return {
    creatives: creativeRows.map((row) => ({
      adId: row.adId,
      adName: row.adName,
      adsetId: row.adsetId,
      adsetName: row.adsetName,
      campaignId: row.campaignId,
      campaignName: row.campaignName,
    })),
    campaigns: campaignRows,
  };
}

export async function upsertMetaCampaigns(
  brandId: string,
  campaigns: Array<{ id: string; name: string; status?: string }>
): Promise<void> {
  for (const part of chunk(campaigns)) {
    await db
      .insert(adCampaigns)
      .values(
        part.map((c) => ({ brandId, platform: "meta" as const, platformCampaignId: c.id, name: c.name, status: c.status ?? "UNKNOWN" }))
      )
      .onConflictDoUpdate({
        target: [adCampaigns.brandId, adCampaigns.platform, adCampaigns.platformCampaignId],
        set: { name: sql`excluded.name`, status: sql`excluded.status`, updatedAt: new Date() },
      });
  }
}

export async function upsertAdCreatives(
  brandId: string,
  rows: Array<Omit<typeof adCreatives.$inferInsert, "brandId" | "id">>
): Promise<void> {
  for (const part of chunk(rows)) {
    await db
      .insert(adCreatives)
      .values(part.map((row) => ({ ...row, brandId })))
      .onConflictDoUpdate({
        target: [adCreatives.brandId, adCreatives.platform, adCreatives.adId],
        set: {
          adName: sql`excluded.ad_name`,
          adsetId: sql`excluded.adset_id`,
          adsetName: sql`excluded.adset_name`,
          campaignId: sql`excluded.campaign_id`,
          campaignName: sql`excluded.campaign_name`,
          creativeId: sql`excluded.creative_id`,
          creativeName: sql`excluded.creative_name`,
          thumbnailUrl: sql`excluded.thumbnail_url`,
          status: sql`excluded.status`,
          updatedAt: new Date(),
        },
      });
  }
}

export async function upsertSpendRows(
  brandId: string,
  rows: Array<Omit<typeof adSpendDaily.$inferInsert, "brandId" | "id">>
): Promise<void> {
  for (const part of chunk(rows)) {
    await db
      .insert(adSpendDaily)
      .values(part.map((row) => ({ ...row, brandId })))
      .onConflictDoUpdate({
        target: [adSpendDaily.brandId, adSpendDaily.platform, adSpendDaily.adId, adSpendDaily.date],
        set: {
          campaignId: sql`excluded.campaign_id`,
          campaignName: sql`excluded.campaign_name`,
          adsetId: sql`excluded.adset_id`,
          adsetName: sql`excluded.adset_name`,
          adName: sql`excluded.ad_name`,
          spend: sql`excluded.spend`,
          impressions: sql`excluded.impressions`,
          clicks: sql`excluded.clicks`,
          purchases: sql`excluded.purchases`,
          fetchedAt: new Date(),
        },
      });
  }
}

// ── Connections ───────────────────────────────────────────────────────────
export async function getConnection(brandId: string, platform: "shopify" | "meta") {
  const rows = await db
    .select()
    .from(platformConnections)
    .where(and(eq(platformConnections.brandId, brandId), eq(platformConnections.platform, platform)))
    .limit(1);
  return rows[0] ?? null;
}

/** Connections for a shop domain (should be 0 or 1: a shop belongs to one brand). */
export async function findShopifyConnectionsByShop(shopDomain: string) {
  return db
    .select({
      brandId: platformConnections.brandId,
      status: platformConnections.status,
      metadata: platformConnections.metadata,
    })
    .from(platformConnections)
    .where(
      and(
        eq(platformConnections.platform, "shopify"),
        sql`lower(${platformConnections.accountId}) = ${shopDomain.toLowerCase()}`
      )
    );
}

export async function markShopifyUninstalled(brandId: string, shopDomain: string): Promise<void> {
  await db
    .update(platformConnections)
    .set({ status: "expired", updatedAt: new Date() })
    .where(
      and(
        eq(platformConnections.brandId, brandId),
        eq(platformConnections.platform, "shopify"),
        sql`lower(${platformConnections.accountId}) = ${shopDomain.toLowerCase()}`
      )
    );
}

export async function brandIdsWithSheet(): Promise<string[]> {
  const rows = await db
    .select({ brandId: profitSettings.brandId })
    .from(profitSettings)
    .where(isNotNull(profitSettings.googleSheetId));
  return rows.map((r) => r.brandId);
}

export async function brandIdsWithActiveConnection(platform: "shopify" | "meta"): Promise<string[]> {
  const rows = await db
    .select({ brandId: platformConnections.brandId })
    .from(platformConnections)
    .where(and(eq(platformConnections.platform, platform), eq(platformConnections.status, "active")));
  return [...new Set(rows.map((r) => r.brandId))];
}

// ── Webhook receipts ──────────────────────────────────────────────────────
export async function recordWebhookReceipt(input: {
  brandId: string | null;
  shopDomain: string;
  webhookId: string;
  topic: string;
  resourceId: string | null;
}): Promise<{ id: string; previousStatus: string | null }> {
  const inserted = await db
    .insert(webhookReceipts)
    .values({ ...input, status: "received" })
    .onConflictDoNothing()
    .returning({ id: webhookReceipts.id });
  if (inserted[0]) return { id: inserted[0].id, previousStatus: null };

  const existing = (
    await db
      .select({ id: webhookReceipts.id, status: webhookReceipts.status })
      .from(webhookReceipts)
      .where(and(eq(webhookReceipts.shopDomain, input.shopDomain), eq(webhookReceipts.webhookId, input.webhookId)))
      .limit(1)
  )[0];
  if (existing && existing.status !== "processed" && existing.status !== "ignored") {
    await db
      .update(webhookReceipts)
      .set({ status: "received", attempts: sql`${webhookReceipts.attempts} + 1` })
      .where(eq(webhookReceipts.id, existing.id));
  }
  return { id: existing?.id ?? "", previousStatus: existing?.status ?? "processed" };
}

export async function markWebhookReceipt(
  id: string,
  status: "processed" | "failed" | "ignored",
  error?: string
): Promise<void> {
  if (!id) return;
  await db
    .update(webhookReceipts)
    .set({ status, error: error ?? null, processedAt: new Date() })
    .where(eq(webhookReceipts.id, id));
}

// ── Sync status ───────────────────────────────────────────────────────────
export async function logPlatformSync(
  brandId: string,
  platform: "meta" | "shopify",
  status: "success" | "failed" | "partial",
  recordsProcessed: number,
  errorMessage?: string
): Promise<void> {
  await db.insert(syncLogs).values({
    brandId,
    platform,
    syncType: platform === "meta" ? "ad_data" : "orders",
    status,
    recordsProcessed,
    errorMessage: errorMessage?.slice(0, 1000),
    startedAt: new Date(),
    completedAt: new Date(),
  });
}

export interface SyncStatusView {
  platform: string;
  status: string;
  at: string;
  records: number;
  error: string | null;
}

export async function latestPlatformSyncs(brandId: string): Promise<SyncStatusView[]> {
  const rows = await db
    .select()
    .from(syncLogs)
    .where(eq(syncLogs.brandId, brandId))
    .orderBy(desc(syncLogs.startedAt))
    .limit(50);
  const latest = new Map<string, SyncStatusView>();
  for (const row of rows) {
    if (latest.has(row.platform)) continue;
    latest.set(row.platform, {
      platform: row.platform,
      status: row.status,
      at: (row.completedAt ?? row.startedAt).toISOString(),
      records: row.recordsProcessed,
      error: row.errorMessage ?? null,
    });
  }
  return [...latest.values()];
}

export async function webhookHealth(brandId: string): Promise<{ lastReceivedAt: string | null; failedLast7Days: number; lastError: string | null }> {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [counts, last, lastFailed] = await Promise.all([
    db
      .select({ failed: sql<number>`count(*)::int` })
      .from(webhookReceipts)
      .where(and(eq(webhookReceipts.brandId, brandId), eq(webhookReceipts.status, "failed"), gte(webhookReceipts.receivedAt, since))),
    db
      .select({ at: webhookReceipts.receivedAt })
      .from(webhookReceipts)
      .where(eq(webhookReceipts.brandId, brandId))
      .orderBy(desc(webhookReceipts.receivedAt))
      .limit(1),
    db
      .select({ error: webhookReceipts.error })
      .from(webhookReceipts)
      .where(and(eq(webhookReceipts.brandId, brandId), eq(webhookReceipts.status, "failed")))
      .orderBy(desc(webhookReceipts.receivedAt))
      .limit(1),
  ]);
  return {
    lastReceivedAt: last[0]?.at ? last[0].at.toISOString() : null,
    failedLast7Days: counts[0]?.failed ?? 0,
    lastError: lastFailed[0]?.error ?? null,
  };
}

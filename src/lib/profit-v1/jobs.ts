/**
 * Sync jobs: Google Sheet config, Meta spend, Shopify catch-up.
 * Called by the "Sync now" API (manager+) and by the cron endpoint.
 */
import { readSheetValues } from "@/lib/integrations/google-sheets";
import { MetaClient, type MetaAdDailyInsight } from "@/lib/platforms/meta/client";
import { ShopifyClient } from "@/lib/platforms/shopify/client";
import { addDays, dateInTimeZone } from "./dates";
import { parseConfigSheet, parseMappingSheet, type SheetRowError } from "./sheet-parse";
import { parseShopifyOrder } from "./shopify-parse";
import * as repo from "./repository";

export interface JobResult {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Unknown error");

// ── Google Sheet ──────────────────────────────────────────────────────────
export async function syncSheetForBrand(brandId: string, triggeredBy: "manual" | "cron"): Promise<JobResult> {
  const settings = await repo.getProfitSettings(brandId);
  if (!settings.googleSheetId) {
    return { ok: false, message: "No Google Sheet configured for this brand" };
  }
  const runId = await repo.startConfigSyncRun(brandId, triggeredBy);
  try {
    const configValues = await readSheetValues(settings.googleSheetId, settings.configRange);
    const parsed = parseConfigSheet(configValues);

    if (parsed.missingColumns.length > 0) {
      const message = `Sheet is missing columns: ${parsed.missingColumns.join(", ")}`;
      await repo.finishConfigSyncRun(brandId, runId, { status: "failed", errorMessage: message });
      return { ok: false, message };
    }

    const errors: SheetRowError[] = [...parsed.errors];
    let mappings: Awaited<ReturnType<typeof parseMappingSheet>>["mappings"] | null = null;
    if (settings.mappingRange) {
      const knownShoes = new Set(parsed.namesInSheet);
      const mappingResult = parseMappingSheet(await readSheetValues(settings.googleSheetId, settings.mappingRange), knownShoes);
      mappings = mappingResult.mappings;
      errors.push(...mappingResult.errors);
    }

    // Safety: an empty/unreadable sheet never wipes the existing configuration.
    if (parsed.configs.length === 0) {
      const message = "No valid shoe rows found in the sheet; existing configuration kept";
      await repo.finishConfigSyncRun(brandId, runId, {
        status: "failed",
        rowsRead: parsed.rowsRead,
        rowsRejected: parsed.errors.length,
        errors,
        errorMessage: message,
      });
      return { ok: false, message, details: { errors } };
    }

    const configSheetRows = new Map<string, number>();
    await repo.applyShoeConfig(brandId, {
      configs: parsed.configs,
      configSheetRows,
      namesInSheet: parsed.namesInSheet,
      mappings,
    });
    const status = errors.length > 0 ? "partial" : "success";
    await repo.finishConfigSyncRun(brandId, runId, {
      status,
      rowsRead: parsed.rowsRead,
      rowsApplied: parsed.configs.length,
      rowsRejected: parsed.errors.length,
      mappingsApplied: mappings?.length ?? 0,
      errors,
    });
    return {
      ok: true,
      message: `Synced ${parsed.configs.length} shoes${errors.length ? `, ${errors.length} rows rejected` : ""}`,
      details: { rowsApplied: parsed.configs.length, errors },
    };
  } catch (error) {
    await repo.finishConfigSyncRun(brandId, runId, { status: "failed", errorMessage: errorMessage(error) });
    return { ok: false, message: errorMessage(error) };
  }
}

// ── Meta ──────────────────────────────────────────────────────────────────
const PURCHASE_ACTIONS = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"];

export function purchasesFromActions(actions: MetaAdDailyInsight["actions"]): number {
  for (const type of PURCHASE_ACTIONS) {
    const hit = actions?.find((action) => action.action_type === type);
    if (hit) return Math.round(Number(hit.value) || 0);
  }
  return 0;
}

export async function syncMetaForBrand(brandId: string, options: { days: number }): Promise<JobResult> {
  const connection = await repo.getConnection(brandId, "meta");
  if (!connection || connection.status !== "active") {
    return { ok: false, message: "Meta is not connected for this brand" };
  }
  try {
    const settings = await repo.getProfitSettings(brandId);
    const client = new MetaClient({
      accessToken: connection.accessToken,
      apiVersion: process.env.META_API_VERSION || "v23.0",
    });
    const accountId = connection.accountId;
    const until = dateInTimeZone(new Date(), settings.timezone);
    const since = addDays(until, -(Math.max(1, options.days) - 1));

    const [campaigns, ads, insights] = await Promise.all([
      client.listCampaigns(accountId),
      client.listAdsWithHierarchy(accountId),
      client.getAdDailyInsights(accountId, since, until),
    ]);

    await repo.upsertMetaCampaigns(brandId, campaigns);
    await repo.upsertAdCreatives(
      brandId,
      ads.map((ad) => ({
        platform: "meta",
        adAccountId: accountId,
        adId: ad.id,
        adName: ad.name,
        adsetId: ad.adset?.id ?? null,
        adsetName: ad.adset?.name ?? null,
        campaignId: ad.campaign?.id ?? null,
        campaignName: ad.campaign?.name ?? null,
        creativeId: ad.creative?.id ?? null,
        creativeName: ad.creative?.name ?? null,
        thumbnailUrl: ad.creative?.thumbnail_url ?? null,
        status: ad.status ?? null,
      }))
    );
    await repo.upsertSpendRows(
      brandId,
      insights.map((row) => ({
        platform: "meta",
        adAccountId: accountId,
        date: row.date_start,
        campaignId: row.campaign_id,
        campaignName: row.campaign_name ?? null,
        adsetId: row.adset_id ?? null,
        adsetName: row.adset_name ?? null,
        adId: row.ad_id,
        adName: row.ad_name ?? null,
        spend: (Number(row.spend) || 0).toFixed(2),
        impressions: Math.round(Number(row.impressions) || 0),
        clicks: Math.round(Number(row.clicks) || 0),
        purchases: purchasesFromActions(row.actions),
      }))
    );
    await repo.logPlatformSync(brandId, "meta", "success", insights.length);
    return { ok: true, message: `Synced ${insights.length} ad-days (${since} → ${until})` };
  } catch (error) {
    await repo.logPlatformSync(brandId, "meta", "failed", 0, errorMessage(error));
    return { ok: false, message: errorMessage(error) };
  }
}

// ── Shopify catch-up (safety net for missed webhooks) ────────────────────
const MAX_SHOPIFY_PAGES = 40;

export async function syncShopifyForBrand(brandId: string, options: { hours: number }): Promise<JobResult> {
  const connection = await repo.getConnection(brandId, "shopify");
  if (!connection || connection.status !== "active") {
    return { ok: false, message: "Shopify is not connected for this brand" };
  }
  try {
    const settings = await repo.getProfitSettings(brandId);
    const shopDomain = connection.accountId.toLowerCase();
    const client = new ShopifyClient({
      storeDomain: shopDomain,
      accessToken: connection.accessToken,
      apiVersion: process.env.SHOPIFY_API_VERSION || "2025-07",
    });
    const since = new Date(Date.now() - options.hours * 3_600_000).toISOString();
    let pageInfo: string | undefined;
    let processed = 0;
    for (let page = 0; page < MAX_SHOPIFY_PAGES; page += 1) {
      const result = await client.listOrdersUpdatedSince(since, pageInfo);
      for (const payload of result.orders) {
        await repo.upsertOrder(brandId, shopDomain, parseShopifyOrder(payload, settings.timezone));
        processed += 1;
      }
      if (!result.nextPageInfo) break;
      pageInfo = result.nextPageInfo;
    }
    await repo.logPlatformSync(brandId, "shopify", "success", processed);
    return { ok: true, message: `Checked ${processed} orders updated in the last ${options.hours}h` };
  } catch (error) {
    await repo.logPlatformSync(brandId, "shopify", "failed", 0, errorMessage(error));
    return { ok: false, message: errorMessage(error) };
  }
}

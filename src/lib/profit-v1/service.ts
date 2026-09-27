/**
 * Dashboard read service: loads raw data + current configuration once, then runs the
 * central engine for the selected range and for the Today / 7D / 15D / 30D strip.
 */
import { presetRange, resolveRange } from "./dates";
import { buildProfitReport, createProfitContext, summarizeRange, type ProfitReport, type Totals } from "./engine";
import * as repo from "./repository";

export class InvalidRangeError extends Error {}

export interface ProfitDashboard {
  generatedAt: string;
  timezone: string;
  rangeLabel: string;
  report: ProfitReport;
  periods: { today: Totals; last7Days: Totals; last15Days: Totals; last30Days: Totals };
  config: {
    shoesConfigured: number;
    googleSheetConfigured: boolean;
    defaultProductGstPercent: number;
    lastSheetSync: {
      status: string;
      at: string;
      rowsApplied: number;
      rowsRejected: number;
      errors: Array<{ tab: string; row: number; shoeName?: string; message: string }>;
      errorMessage: string | null;
    } | null;
  };
  syncs: repo.SyncStatusView[];
  webhooks: Awaited<ReturnType<typeof repo.webhookHealth>>;
}

export async function getProfitDashboard(
  brandId: string,
  input: { range?: string | null; from?: string | null; to?: string | null },
  now: Date = new Date()
): Promise<ProfitDashboard> {
  const settings = await repo.getProfitSettings(brandId);
  const resolved = resolveRange(input, settings.timezone, now);
  if (!resolved.ok) throw new InvalidRangeError(resolved.error);

  const today = presetRange("today", settings.timezone, now);
  const d7 = presetRange("7d", settings.timezone, now);
  const d15 = presetRange("15d", settings.timezone, now);
  const d30 = presetRange("30d", settings.timezone, now);
  const loadFrom = resolved.range.from < d30.from ? resolved.range.from : d30.from;
  const loadTo = resolved.range.to > today.to ? resolved.range.to : today.to;

  const [orders, spend, configs, mappings, meta, lastSheetSync, syncs, webhooks] = await Promise.all([
    repo.loadOrdersForRange(brandId, loadFrom, loadTo),
    repo.loadSpendForRange(brandId, loadFrom, loadTo),
    repo.loadShoeConfigs(brandId),
    repo.loadNameMappings(brandId),
    repo.loadMetaEntities(brandId),
    repo.latestConfigSyncRun(brandId),
    repo.latestPlatformSyncs(brandId),
    repo.webhookHealth(brandId),
  ]);

  const ctx = createProfitContext({
    configs,
    mappings,
    creatives: meta.creatives,
    campaigns: meta.campaigns,
    defaultGstPercent: settings.defaultProductGstPercent,
  });

  return {
    generatedAt: now.toISOString(),
    timezone: settings.timezone,
    rangeLabel: resolved.label,
    report: buildProfitReport(ctx, orders, spend, resolved.range),
    periods: {
      today: summarizeRange(ctx, orders, spend, today),
      last7Days: summarizeRange(ctx, orders, spend, d7),
      last15Days: summarizeRange(ctx, orders, spend, d15),
      last30Days: summarizeRange(ctx, orders, spend, d30),
    },
    config: {
      shoesConfigured: configs.length,
      googleSheetConfigured: Boolean(settings.googleSheetId),
      defaultProductGstPercent: settings.defaultProductGstPercent,
      lastSheetSync: lastSheetSync
        ? {
            status: lastSheetSync.status,
            at: (lastSheetSync.finishedAt ?? lastSheetSync.startedAt).toISOString(),
            rowsApplied: lastSheetSync.rowsApplied,
            rowsRejected: lastSheetSync.rowsRejected,
            errors: lastSheetSync.errors ?? [],
            errorMessage: lastSheetSync.errorMessage ?? null,
          }
        : null,
    },
    syncs,
    webhooks,
  };
}

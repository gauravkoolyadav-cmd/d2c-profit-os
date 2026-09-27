"use client";

import { Badge } from "@/components/ui/badge";
import type { DashboardData } from "./types";
import { formatCount, formatINR, timeAgo } from "./format";

interface Issue {
  level: "error" | "warning";
  title: string;
  detail?: string;
  items?: string[];
}

export function collectIssues(data: DashboardData): Issue[] {
  const issues: Issue[] = [];
  const { health } = data.report;
  const sheet = data.config.lastSheetSync;

  if (!data.config.googleSheetConfigured) {
    issues.push({ level: "error", title: "Google Sheet not connected", detail: "Add the sheet in Settings below. Profit cannot be calculated without shoe economics." });
  } else if (!sheet) {
    issues.push({ level: "warning", title: "Google Sheet has not been synced yet", detail: "Click “Sync Google Sheet”." });
  } else if (sheet.status === "failed") {
    issues.push({ level: "error", title: "Google Sheet sync failed", detail: `${sheet.errorMessage ?? "Unknown error"} (${timeAgo(sheet.at)}). Last good values are still used.` });
  }
  if (sheet && sheet.errors.length > 0) {
    issues.push({
      level: "warning",
      title: `${sheet.errors.length} invalid sheet row(s) were rejected`,
      detail: "Rejected rows are not used; shoes keep their last valid values.",
      items: sheet.errors.slice(0, 20).map((e) => `${e.tab} row ${e.row}${e.shoeName ? ` (${e.shoeName})` : ""}: ${e.message}`),
    });
  }
  if (health.unmappedProducts.length > 0) {
    issues.push({
      level: "error",
      title: `${health.unmappedProducts.length} unmapped product(s): excluded from profit`,
      detail: "Add the shoe to the sheet or add a row in the Mapping tab.",
      items: health.unmappedProducts.slice(0, 20).map((p) => `${p.productTitle}: ${formatCount(p.units)} pairs in ${formatCount(p.orders)} orders${p.reason === "AMBIGUOUS" ? " (matches more than one shoe)" : p.reason === "MAPPING_TARGET_MISSING" ? " (mapping points to a shoe not in the config tab)" : ""}`),
    });
  }
  if (health.excluded.unknownPaymentType > 0) {
    issues.push({ level: "warning", title: `${health.excluded.unknownPaymentType} order(s) with unknown payment type: excluded`, detail: "Payment is neither prepaid, COD nor partial COD." });
  }
  if (health.attribution.unattributed > 0) {
    issues.push({ level: "warning", title: `${health.attribution.unattributed} order(s) have no campaign/creative attribution`, detail: "Shown as UNATTRIBUTED; counted in total profit only." });
  }
  if (health.attribution.utmNotMatched > 0) {
    issues.push({ level: "warning", title: `${health.attribution.utmNotMatched} order(s) have UTM campaign not found in Meta`, detail: "Run a Meta sync, or check the UTM values in your ads." });
  }
  if (health.attribution.campaignOnly > 0) {
    issues.push({ level: "warning", title: `${health.attribution.campaignOnly} order(s) have campaign but no creative`, detail: "Use utm_content={{ad.id}} in Meta URL parameters." });
  }
  if (health.datesWithOrdersButNoSpend.length > 0) {
    issues.push({ level: "warning", title: "Meta spend missing for some days with orders", items: health.datesWithOrdersButNoSpend });
  }
  if (health.priceMismatches.length > 0) {
    issues.push({
      level: "warning",
      title: `${health.priceMismatches.length} line(s) where the Shopify price differs from the sheet price by more than 10%`,
      detail: "Profit uses the sheet price. Check if the sheet is up to date.",
      items: health.priceMismatches.slice(0, 10).map((m) => `#${m.orderNumber} ${m.shoeName}: Shopify ${formatINR(m.shopifyPrice)} vs sheet ${formatINR(m.sheetPrice)}`),
    });
  }
  for (const sync of data.syncs) {
    if (sync.status === "failed") {
      issues.push({ level: "error", title: `${sync.platform === "meta" ? "Meta" : "Shopify"} sync failed ${timeAgo(sync.at)}`, detail: sync.error ?? undefined });
    }
  }
  if (data.webhooks.failedLast7Days > 0) {
    issues.push({ level: "error", title: `${data.webhooks.failedLast7Days} Shopify webhook(s) failed in the last 7 days`, detail: data.webhooks.lastError ?? "The hourly catch-up sync re-imports missed orders." });
  }
  return issues;
}

export function HealthPanel({ data }: { data: DashboardData }) {
  const issues = collectIssues(data);
  const meta = data.syncs.find((s) => s.platform === "meta");
  const shopify = data.syncs.find((s) => s.platform === "shopify");
  return (
    <div className="space-y-4">
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Status label="Google Sheet" value={data.config.lastSheetSync ? `${data.config.lastSheetSync.status} · ${timeAgo(data.config.lastSheetSync.at)}` : "not synced"} sub={`${data.config.shoesConfigured} shoes configured`} />
        <Status label="Meta spend" value={meta ? `${meta.status} · ${timeAgo(meta.at)}` : "not synced"} />
        <Status label="Shopify webhooks" value={data.webhooks.lastReceivedAt ? `last order ${timeAgo(data.webhooks.lastReceivedAt)}` : "none received yet"} />
        <Status label="Shopify catch-up" value={shopify ? `${shopify.status} · ${timeAgo(shopify.at)}` : "not run"} />
      </div>
      {issues.length === 0 ? (
        <p className="text-sm text-emerald-700">All good: no data issues for this period.</p>
      ) : (
        <ul className="space-y-3">
          {issues.map((issue, i) => (
            <li key={i} className="rounded-md border p-3">
              <div className="flex items-start gap-2">
                <Badge variant={issue.level === "error" ? "destructive" : "secondary"}>{issue.level === "error" ? "Error" : "Check"}</Badge>
                <div className="space-y-1">
                  <p className="text-sm font-medium">{issue.title}</p>
                  {issue.detail && <p className="text-xs text-muted-foreground">{issue.detail}</p>}
                  {issue.items && (
                    <ul className="list-disc pl-4 text-xs text-muted-foreground">
                      {issue.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Status({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium capitalize">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

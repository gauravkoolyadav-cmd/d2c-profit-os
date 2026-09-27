"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import { DataTable, profitClass, type Column } from "./data-table";
import { ProfitTrendChart } from "./profit-chart";
import { HealthPanel, collectIssues } from "./health-panel";
import { SettingsPanel, SyncButtons } from "./settings-panel";
import { formatCount, formatINR, formatPercent, timeAgo } from "./format";
import type { DashboardData, Totals } from "./types";

type RangeKey = "today" | "yesterday" | "7d" | "15d" | "30d" | "custom";
const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "15d", label: "15 days" },
  { key: "30d", label: "30 days" },
  { key: "custom", label: "Custom" },
];

/** Live refresh: new Shopify orders and syncs show up within this interval. */
const REFRESH_MS = 30_000;

const fetcher = async (url: string): Promise<DashboardData> => {
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to load dashboard");
  return json;
};

type Report = DashboardData["report"];

export function ProfitDashboard({ brandId, brandName, role }: { brandId: string; brandName: string; role: string }) {
  const [range, setRange] = useState<RangeKey>("today");
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [appliedCustom, setAppliedCustom] = useState<{ from: string; to: string } | null>(null);
  const [tab, setTab] = useState<"campaigns" | "creatives" | "shoes" | "orders">("campaigns");
  const [, setTick] = useState(0);
  const canEdit = role === "owner" || role === "manager";

  const url = useMemo(() => {
    const params = new URLSearchParams({ range });
    if (range === "custom") {
      if (!appliedCustom) return null;
      params.set("from", appliedCustom.from);
      params.set("to", appliedCustom.to);
    }
    return `/api/brands/${brandId}/profit-dashboard?${params.toString()}`;
  }, [brandId, range, appliedCustom]);

  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    refreshInterval: REFRESH_MS,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });

  // re-render the "updated Xs ago" label every 5 s
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const issueCount = data ? collectIssues(data).length : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{brandName}: Profit</h1>
          <p className="text-sm text-muted-foreground">
            Shopify orders × Google Sheet economics × Meta spend (incl. 18% GST).{" "}
            {data && <>Timezone {data.timezone}.</>}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live · updated {data ? timeAgo(data.generatedAt) : "…"}
          <Button size="sm" variant="ghost" onClick={() => mutate()}>
            Refresh
          </Button>
        </div>
      </div>

      {error && !data && (
        <Card>
          <CardContent className="p-6 text-sm text-red-600">{String(error.message ?? error)}</CardContent>
        </Card>
      )}

      {/* Today */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Today's orders" value={formatCount(data?.periods.today.orders)} loading={!data} />
        <Kpi
          label="Today's revenue"
          value={formatINR(data?.periods.today.netRevenue)}
          sub={data ? `ex-GST · ${formatINR(data.periods.today.grossRevenue)} incl. GST` : undefined}
          loading={!data}
        />
        <Kpi
          label="Today's ad spend"
          value={formatINR(data?.periods.today.metaCost)}
          sub={data ? `incl. GST · spend ${formatINR(data.periods.today.metaSpend)} + GST ${formatINR(data.periods.today.metaGst)}` : undefined}
          loading={!data}
        />
        <Kpi label="Today's profit" value={formatINR(data?.periods.today.profit)} tone={data?.periods.today.profit} loading={!data} />
      </section>

      {/* Period strip */}
      <section className="grid gap-4 sm:grid-cols-3">
        <PeriodCard label="Last 7 days profit" totals={data?.periods.last7Days} />
        <PeriodCard label="Last 15 days profit" totals={data?.periods.last15Days} />
        <PeriodCard label="Last 30 days profit" totals={data?.periods.last30Days} />
      </section>

      {/* Range selector */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          {RANGES.map((r) => (
            <Button key={r.key} size="sm" variant={range === r.key ? "default" : "outline"} onClick={() => setRange(r.key)}>
              {r.label}
            </Button>
          ))}
          {range === "custom" && (
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" className="w-40" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="From" />
              <span className="text-sm text-muted-foreground">to</span>
              <Input type="date" className="w-40" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="To" />
              <Button size="sm" disabled={!custom.from || !custom.to || custom.from > custom.to} onClick={() => setAppliedCustom({ ...custom })}>
                Apply
              </Button>
            </div>
          )}
          {data && (
            <span className="ml-auto text-xs text-muted-foreground">
              {data.report.range.from === data.report.range.to ? data.report.range.from : `${data.report.range.from} → ${data.report.range.to}`}
            </span>
          )}
        </CardContent>
      </Card>

      {range === "custom" && !appliedCustom ? (
        <p className="text-sm text-muted-foreground">Choose a from and to date, then Apply.</p>
      ) : (
        <>
          {/* Selected-period breakdown */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <Kpi label="Orders" value={formatCount(data?.report.totals.orders)} sub={data ? paymentSplit(data.report) : undefined} loading={isLoading && !data} />
            <Kpi label="Revenue (ex-GST)" value={formatINR(data?.report.totals.netRevenue)} sub={data ? `GST ${formatINR(data.report.totals.gst)}` : undefined} loading={isLoading && !data} />
            <Kpi label="Product cost" value={formatINR(data?.report.totals.productCost)} loading={isLoading && !data} />
            <Kpi label="Shipping" value={formatINR(data?.report.totals.shippingCost)} sub="once per order" loading={isLoading && !data} />
            <Kpi label="Ad spend (incl. GST)" value={formatINR(data?.report.totals.metaCost)} sub={data ? `${formatINR(data.report.totals.metaSpend)} × 1.18` : undefined} loading={isLoading && !data} />
            <Kpi label="Profit" value={formatINR(data?.report.totals.profit)} tone={data?.report.totals.profit} loading={isLoading && !data} />
            <Kpi label="Margin" value={formatPercent(data?.report.totals.marginPercent)} sub="profit ÷ revenue (ex-GST)" loading={isLoading && !data} />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Revenue, ad spend and profit</CardTitle>
              <CardDescription>Daily, for the selected period</CardDescription>
            </CardHeader>
            <CardContent>{data && <ProfitTrendChart daily={data.report.daily} />}</CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    ["campaigns", "Campaigns"],
                    ["creatives", "Creatives"],
                    ["shoes", "Shoes"],
                    ["orders", "Orders"],
                  ] as const
                ).map(([key, label]) => (
                  <Button key={key} size="sm" variant={tab === key ? "default" : "ghost"} onClick={() => setTab(key)}>
                    {label}
                  </Button>
                ))}
              </div>
              <CardDescription>
                Only orders that carry campaign/creative attribution are counted under a campaign. Everything else stays in UNATTRIBUTED; nothing is spread across campaigns.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data && tab === "campaigns" && <CampaignTable report={data.report} />}
              {data && tab === "creatives" && <CreativeTable report={data.report} />}
              {data && tab === "shoes" && <ShoeTable report={data.report} />}
              {data && tab === "orders" && <OrderTable report={data.report} />}
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Data health</CardTitle>
            {data && (issueCount === 0 ? <Badge variant="secondary">OK</Badge> : <Badge variant="destructive">{issueCount} to check</Badge>)}
          </div>
          <CardDescription>Nothing is hidden: unmapped shoes, missing attribution and failed syncs are listed here.</CardDescription>
        </CardHeader>
        <CardContent>{data && <HealthPanel data={data} />}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Google Sheet & sync</CardTitle>
          <CardDescription>
            Edit prices, costs, shipping and delivery % in your Google Sheet, then sync (automatic every 15 minutes). Profit recalculates for every date.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {canEdit && <SyncButtons brandId={brandId} onDone={() => mutate()} />}
          <SettingsPanel brandId={brandId} canEdit={canEdit} onSaved={() => mutate()} />
        </CardContent>
      </Card>
    </div>
  );
}

function paymentSplit(report: Report): string {
  const p = report.byPaymentType;
  return `Prepaid ${p.PREPAID} · COD ${p.COD} · Partial ${p.PARTIAL_COD}`;
}

function Kpi({ label, value, sub, tone, loading }: { label: string; value: string; sub?: string; tone?: number; loading?: boolean }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={cn("text-2xl font-semibold tabular-nums", tone !== undefined && (tone < 0 ? "text-red-600" : "text-emerald-700"))}>
          {loading ? <span className="inline-block h-7 w-24 animate-pulse rounded bg-muted" /> : value}
        </p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function PeriodCard({ label, totals }: { label: string; totals?: Totals }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={cn("text-2xl font-semibold tabular-nums", totals && (totals.profit < 0 ? "text-red-600" : "text-emerald-700"))}>
          {totals ? formatINR(totals.profit) : <span className="inline-block h-7 w-24 animate-pulse rounded bg-muted" />}
        </p>
        {totals && (
          <p className="text-xs text-muted-foreground">
            {formatCount(totals.orders)} orders · revenue {formatINR(totals.netRevenue)} · ads {formatINR(totals.metaCost)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const money = <T extends Totals>(key: keyof Totals, header: string, hint?: string): Column<T> => ({
  key,
  header,
  hint,
  align: "right",
  render: (row) => formatINR(row[key] as number),
});

const profitColumn = <T extends Totals>(): Column<T> => ({
  key: "profit",
  header: "Profit",
  align: "right",
  render: (row) => formatINR(row.profit),
  className: (row) => profitClass(row.profit),
});

function CampaignTable({ report }: { report: Report }) {
  type Row = Report["campaigns"][number];
  const columns: Column<Row>[] = [
    {
      key: "campaign",
      header: "Campaign",
      render: (row) => (
        <span className="flex items-center gap-2">
          {row.campaignName}
          {!row.matchedToMeta && row.key !== "UNATTRIBUTED" && <Badge variant="outline">UTM only</Badge>}
        </span>
      ),
    },
    { key: "orders", header: "Orders", align: "right", render: (row) => formatCount(row.orders) },
    money("netRevenue", "Revenue", "ex-GST expected revenue"),
    money("productCost", "Product cost"),
    money("shippingCost", "Shipping"),
    money("metaSpend", "Meta spend", "excl. GST"),
    money("metaGst", "GST on Meta", "18%"),
    money("totalCost", "Total cost"),
    profitColumn(),
  ];
  return <DataTable rows={report.campaigns} columns={columns} rowKey={(r) => r.key} />;
}

function CreativeTable({ report }: { report: Report }) {
  type Row = Report["creatives"][number];
  const columns: Column<Row>[] = [
    { key: "creative", header: "Creative", render: (row) => row.creativeName },
    { key: "campaign", header: "Campaign", render: (row) => <span className="text-muted-foreground">{row.campaignName}</span> },
    { key: "orders", header: "Orders", align: "right", render: (row) => formatCount(row.orders) },
    money("netRevenue", "Revenue", "ex-GST expected revenue"),
    money("productCost", "Product cost"),
    money("shippingCost", "Shipping"),
    money("metaSpend", "Meta spend", "excl. GST"),
    money("metaGst", "GST on Meta", "18%"),
    profitColumn(),
  ];
  return <DataTable rows={report.creatives} columns={columns} rowKey={(r) => r.key} />;
}

function ShoeTable({ report }: { report: Report }) {
  type Row = Report["shoes"][number];
  const columns: Column<Row>[] = [
    { key: "shoe", header: "Shoe", render: (row) => row.shoeName },
    { key: "orders", header: "Orders", align: "right", render: (row) => formatCount(row.orders) },
    { key: "units", header: "Pairs", align: "right", render: (row) => formatCount(row.units) },
    money("netRevenue", "Revenue", "ex-GST expected revenue"),
    money("productCost", "Product cost"),
    money("shippingCost", "Shipping"),
    money("metaCost", "Ad spend", "incl. GST; spend of each creative split by the shoes in its attributed orders"),
    profitColumn(),
  ];
  const u = report.unallocatedAdSpend;
  return (
    <div className="space-y-2">
      <DataTable rows={report.shoes} columns={columns} rowKey={(r) => r.shoeName} />
      {u.metaCost > 0 && (
        <p className="text-xs text-muted-foreground">
          Ad spend not linked to any shoe (creatives with no attributed orders): {formatINR(u.metaCost)} incl. GST. It is included in total profit, not in shoe profit.
        </p>
      )}
    </div>
  );
}

function OrderTable({ report }: { report: Report }) {
  type Row = Report["orders"][number];
  const columns: Column<Row>[] = [
    { key: "order", header: "Order", render: (row) => `#${row.orderNumber.replace(/^#/, "")}` },
    { key: "date", header: "Date", render: (row) => row.orderDate },
    { key: "shoes", header: "Shoe(s)", render: (row) => <span className="max-w-[220px] truncate inline-block align-bottom">{row.shoes}</span> },
    { key: "payment", header: "Payment", render: (row) => row.paymentType.replace("_", " ") },
    { key: "status", header: "Status", render: (row) => row.orderStatus },
    { key: "campaign", header: "Campaign", render: (row) => row.campaignName },
    { key: "creative", header: "Creative", render: (row) => row.creativeName },
    { key: "revenue", header: "Revenue", align: "right", render: (row) => formatINR(row.netRevenue) },
    { key: "profit", header: "Profit", align: "right", render: (row) => formatINR(row.profit), className: (row) => profitClass(row.profit) },
    {
      key: "included",
      header: "",
      render: (row) =>
        row.included ? null : (
          <Badge variant="outline" title="Not counted in profit">
            {row.exclusionReason === "CANCELLED" ? "Cancelled" : row.exclusionReason === "NO_MAPPED_ITEMS" ? "Unmapped" : "Unknown payment"}
          </Badge>
        ),
    },
  ];
  return (
    <div className="space-y-2">
      <DataTable rows={report.orders} columns={columns} rowKey={(r) => r.orderId} initialLimit={25} />
      {report.ordersTotal > report.orders.length && (
        <p className="text-xs text-muted-foreground">Showing the latest {report.orders.length} of {report.ordersTotal} orders.</p>
      )}
    </div>
  );
}

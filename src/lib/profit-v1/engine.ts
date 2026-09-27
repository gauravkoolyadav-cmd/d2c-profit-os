/**
 * THE central V1 profit engine. Every profit number on the dashboard comes from here.
 * Pure functions only: no database, no network. Inputs are raw orders + current sheet
 * configuration + Meta spend, so changing the sheet changes every result on the next read.
 *
 * Per order line (mapped to a shoe):
 *   Selling price, shipping and delivery % are chosen by payment type:
 *     PREPAID            → Prepaid SP, Prepaid shipping, Prepaid delivery %
 *     COD / PARTIAL_COD  → COD/Partial SP, COD shipping, COD/Partial delivery %
 *   Expected revenue (incl. GST) = SP × quantity × delivery %
 *   Net revenue (ex-GST)         = expected revenue ÷ (1 + GST %)
 *   GST                          = expected revenue − net revenue
 *   Product cost                 = product cost × quantity × delivery %   (RTO pairs return to stock)
 * Per order:
 *   Shipping                     = charged ONCE per order (delivered or RTO), never twice
 *   Order profit                 = net revenue − product cost − shipping
 * Meta:
 *   Meta cost                    = Meta spend × 1.18  (spend + 18% GST)
 * Campaign / creative profit     = order profit of attributed orders − their Meta cost
 * Total profit                   = order profit of all included orders − all Meta cost
 */
import {
  resolveAttribution,
  buildMetaIndex,
  UNATTRIBUTED,
  type MetaIndex,
  type ResolvedAttribution,
} from "./attribution";
import { buildShoeIndex, normalizeName, resolveShoe, type MappingMethod, type ShoeIndex, type UnmappedReason } from "./names";
import { isDateInRange, listDates } from "./dates";
import type {
  DateRange,
  EngineOrder,
  MetaCampaign,
  MetaCreative,
  NameMapping,
  PaymentType,
  ShoeConfig,
  SpendRow,
} from "./types";

// ── Central constants (the ONLY place these rules live) ────────────────────
export const META_GST_RATE = 0.18;
/** When true, product cost is only counted for the expected-delivered share (RTO pairs come back). */
export const PRODUCT_COST_ON_DELIVERED_SHARE = true;

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ── Payment type → which sheet columns to use ─────────────────────────────
export interface PaymentEconomics {
  basis: "PREPAID" | "COD_OR_PARTIAL";
  sellingPrice: number;
  shippingCost: number;
  /** 0–100 */
  deliveryPercent: number;
}

export function economicsForPaymentType(config: ShoeConfig, paymentType: PaymentType): PaymentEconomics | null {
  switch (paymentType) {
    case "PREPAID":
      return {
        basis: "PREPAID",
        sellingPrice: config.prepaidSellingPrice,
        shippingCost: config.prepaidShippingCost,
        deliveryPercent: config.prepaidDeliveryPercent,
      };
    case "COD":
    case "PARTIAL_COD":
      return {
        basis: "COD_OR_PARTIAL",
        sellingPrice: config.codOrPartialSellingPrice,
        shippingCost: config.codShippingCost,
        deliveryPercent: config.codOrPartialDeliveryPercent,
      };
    default:
      return null;
  }
}

// ── Meta cost ─────────────────────────────────────────────────────────────
export interface MetaCost {
  spend: number;
  gst: number;
  total: number;
}

export function metaCost(spend: number): MetaCost {
  return { spend, gst: spend * META_GST_RATE, total: spend * (1 + META_GST_RATE) };
}

// ── Context ───────────────────────────────────────────────────────────────
export interface ProfitContext {
  shoes: ShoeIndex;
  meta: MetaIndex;
  defaultGstPercent: number;
}

export function createProfitContext(input: {
  configs: ShoeConfig[];
  mappings: NameMapping[];
  creatives: MetaCreative[];
  campaigns: MetaCampaign[];
  defaultGstPercent: number;
}): ProfitContext {
  return {
    shoes: buildShoeIndex(input.configs, input.mappings),
    meta: buildMetaIndex(input.creatives, input.campaigns),
    defaultGstPercent: input.defaultGstPercent,
  };
}

// ── Order profit ──────────────────────────────────────────────────────────
export interface LineProfit {
  productTitle: string;
  variantTitle: string | null;
  quantity: number;
  shopifyUnitPrice: number;
  shoeName: string | null;
  mappingMethod: MappingMethod | null;
  unmappedReason: UnmappedReason | null;
  sellingPrice: number;
  deliveryPercent: number;
  gstPercent: number;
  grossRevenue: number;
  gst: number;
  netRevenue: number;
  productCost: number;
  shippingAllocated: number;
  profit: number;
}

export type ExclusionReason = "CANCELLED" | "UNKNOWN_PAYMENT_TYPE" | "NO_MAPPED_ITEMS";

export interface OrderProfit {
  orderId: string;
  orderNumber: string;
  orderDate: string;
  createdAt: string;
  paymentType: PaymentType;
  orderStatus: EngineOrder["orderStatus"];
  shopifyTotalPrice: number;
  included: boolean;
  exclusionReason: ExclusionReason | null;
  attribution: ResolvedAttribution;
  lines: LineProfit[];
  units: number;
  unmappedUnits: number;
  grossRevenue: number;
  gst: number;
  netRevenue: number;
  productCost: number;
  shippingCost: number;
  profit: number;
}

export function calculateOrderProfit(order: EngineOrder, ctx: ProfitContext): OrderProfit {
  const attribution = resolveAttribution(order.attribution, ctx.meta);
  const cancelled = order.orderStatus === "CANCELLED";

  const lines: LineProfit[] = order.items.map((item) => {
    const match = resolveShoe(item, ctx.shoes);
    const economics = match.shoe ? economicsForPaymentType(match.shoe, order.paymentType) : null;
    const base: LineProfit = {
      productTitle: item.productTitle,
      variantTitle: item.variantTitle,
      quantity: item.quantity,
      shopifyUnitPrice: item.unitPrice,
      shoeName: match.shoe?.shoeName ?? null,
      mappingMethod: match.method,
      unmappedReason: match.reason,
      sellingPrice: 0,
      deliveryPercent: 0,
      gstPercent: 0,
      grossRevenue: 0,
      gst: 0,
      netRevenue: 0,
      productCost: 0,
      shippingAllocated: 0,
      profit: 0,
    };
    if (!match.shoe || !economics || cancelled) return base;

    const delivery = economics.deliveryPercent / 100;
    const gstPercent = match.shoe.gstPercent ?? ctx.defaultGstPercent;
    const grossRevenue = economics.sellingPrice * item.quantity * delivery;
    const netRevenue = grossRevenue / (1 + gstPercent / 100);
    const productCost =
      match.shoe.productCost * item.quantity * (PRODUCT_COST_ON_DELIVERED_SHARE ? delivery : 1);
    return {
      ...base,
      sellingPrice: economics.sellingPrice,
      deliveryPercent: economics.deliveryPercent,
      gstPercent,
      grossRevenue,
      gst: grossRevenue - netRevenue,
      netRevenue,
      productCost,
      profit: netRevenue - productCost,
    };
  });

  const mappedLines = lines.filter((line) => line.shoeName !== null);
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  const unmappedUnits = lines.filter((line) => line.shoeName === null).reduce((s, l) => s + l.quantity, 0);

  let exclusionReason: ExclusionReason | null = null;
  if (cancelled) exclusionReason = "CANCELLED";
  else if (order.paymentType === "UNKNOWN") exclusionReason = "UNKNOWN_PAYMENT_TYPE";
  else if (mappedLines.length === 0) exclusionReason = "NO_MAPPED_ITEMS";

  const result: OrderProfit = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    orderDate: order.orderDate,
    createdAt: order.createdAt,
    paymentType: order.paymentType,
    orderStatus: order.orderStatus,
    shopifyTotalPrice: order.totalPrice,
    included: exclusionReason === null,
    exclusionReason,
    attribution,
    lines,
    units,
    unmappedUnits,
    grossRevenue: 0,
    gst: 0,
    netRevenue: 0,
    productCost: 0,
    shippingCost: 0,
    profit: 0,
  };
  if (!result.included) return result;

  // Shipping: exactly ONCE per order. If an order has several shoes, the highest
  // shipping value among them is used (one parcel, one charge).
  const shippingCost = Math.max(
    ...mappedLines.map((line) => {
      const shoe = ctx.shoes.byName.get(normalizeName(line.shoeName));
      return shoe ? (economicsForPaymentType(shoe, order.paymentType)?.shippingCost ?? 0) : 0;
    })
  );
  const mappedUnits = mappedLines.reduce((sum, line) => sum + line.quantity, 0);
  for (const line of mappedLines) {
    line.shippingAllocated = mappedUnits > 0 ? (shippingCost * line.quantity) / mappedUnits : 0;
    line.profit = line.netRevenue - line.productCost - line.shippingAllocated;
  }

  result.grossRevenue = sum(mappedLines, "grossRevenue");
  result.gst = sum(mappedLines, "gst");
  result.netRevenue = sum(mappedLines, "netRevenue");
  result.productCost = sum(mappedLines, "productCost");
  result.shippingCost = shippingCost;
  result.profit = result.netRevenue - result.productCost - shippingCost;
  return result;
}

function sum<T>(rows: T[], key: keyof T): number {
  return rows.reduce((total, row) => total + (row[key] as unknown as number), 0);
}

// ── Aggregation ───────────────────────────────────────────────────────────
export interface Totals {
  orders: number;
  units: number;
  /** Expected revenue incl. GST (sheet SP × qty × delivery %) */
  grossRevenue: number;
  gst: number;
  /** Expected revenue ex-GST: the revenue used for profit */
  netRevenue: number;
  productCost: number;
  shippingCost: number;
  /** Meta spend excl. GST */
  metaSpend: number;
  metaGst: number;
  /** Meta spend × 1.18 */
  metaCost: number;
  /** product cost + shipping + Meta cost */
  totalCost: number;
  profit: number;
  /** profit ÷ net revenue × 100 (null when there is no revenue) */
  marginPercent: number | null;
}

interface Accumulator {
  orders: number;
  units: number;
  grossRevenue: number;
  gst: number;
  netRevenue: number;
  productCost: number;
  shippingCost: number;
  metaSpend: number;
}

const emptyAccumulator = (): Accumulator => ({
  orders: 0,
  units: 0,
  grossRevenue: 0,
  gst: 0,
  netRevenue: 0,
  productCost: 0,
  shippingCost: 0,
  metaSpend: 0,
});

function addOrder(acc: Accumulator, order: OrderProfit): void {
  acc.orders += 1;
  acc.units += order.units - order.unmappedUnits;
  acc.grossRevenue += order.grossRevenue;
  acc.gst += order.gst;
  acc.netRevenue += order.netRevenue;
  acc.productCost += order.productCost;
  acc.shippingCost += order.shippingCost;
}

export function finalizeTotals(acc: Accumulator): Totals {
  const cost = metaCost(acc.metaSpend);
  const totalCost = acc.productCost + acc.shippingCost + cost.total;
  const profit = acc.netRevenue - totalCost;
  return {
    orders: acc.orders,
    units: acc.units,
    grossRevenue: round2(acc.grossRevenue),
    gst: round2(acc.gst),
    netRevenue: round2(acc.netRevenue),
    productCost: round2(acc.productCost),
    shippingCost: round2(acc.shippingCost),
    metaSpend: round2(cost.spend),
    metaGst: round2(cost.gst),
    metaCost: round2(cost.total),
    totalCost: round2(totalCost),
    profit: round2(profit),
    marginPercent: acc.netRevenue > 0 ? round2((profit / acc.netRevenue) * 100) : null,
  };
}

export interface CampaignRow extends Totals {
  key: string;
  campaignId: string | null;
  campaignName: string;
  matchedToMeta: boolean;
  impressions: number;
  clicks: number;
  metaPurchases: number;
}

export interface CreativeRow extends Totals {
  key: string;
  creativeId: string | null;
  creativeName: string;
  campaignKey: string;
  campaignName: string;
  adsetName: string | null;
  matchedToMeta: boolean;
  impressions: number;
  clicks: number;
}

export interface ShoeRow extends Totals {
  shoeName: string;
}

export interface DailyRow extends Totals {
  date: string;
}

export interface OrderRow {
  orderId: string;
  orderNumber: string;
  orderDate: string;
  createdAt: string;
  paymentType: PaymentType;
  orderStatus: string;
  included: boolean;
  exclusionReason: ExclusionReason | null;
  shoes: string;
  units: number;
  shopifyTotalPrice: number;
  grossRevenue: number;
  netRevenue: number;
  productCost: number;
  shippingCost: number;
  profit: number;
  campaignName: string;
  creativeName: string;
  attributionMethod: string;
  matchedToMeta: boolean;
}

export interface DataHealth {
  unmappedProducts: Array<{ productTitle: string; reason: UnmappedReason; units: number; orders: number }>;
  excluded: { cancelled: number; unknownPaymentType: number; noMappedItems: number };
  attribution: {
    matchedToMeta: number;
    utmNotMatched: number;
    campaignOnly: number;
    unattributed: number;
    coveragePercent: number | null;
  };
  datesWithOrdersButNoSpend: string[];
  priceMismatches: Array<{ orderNumber: string; shoeName: string; shopifyPrice: number; sheetPrice: number }>;
}

export interface ProfitReport {
  range: DateRange;
  totals: Totals;
  byPaymentType: Record<PaymentType, number>;
  byStatus: Record<string, number>;
  daily: DailyRow[];
  campaigns: CampaignRow[];
  creatives: CreativeRow[];
  shoes: ShoeRow[];
  unallocatedAdSpend: { metaSpend: number; metaGst: number; metaCost: number };
  orders: OrderRow[];
  ordersTotal: number;
  health: DataHealth;
}

const PRICE_MISMATCH_THRESHOLD = 0.1;

export function buildProfitReport(
  ctx: ProfitContext,
  allOrders: EngineOrder[],
  allSpend: SpendRow[],
  range: DateRange,
  options: { orderLimit?: number } = {}
): ProfitReport {
  const orders = allOrders.filter((order) => isDateInRange(order.orderDate, range));
  const spend = allSpend.filter((row) => isDateInRange(row.date, range));
  const results = orders.map((order) => calculateOrderProfit(order, ctx));
  const included = results.filter((result) => result.included);

  // Totals
  const totalAcc = emptyAccumulator();
  for (const order of included) addOrder(totalAcc, order);
  totalAcc.metaSpend = spend.reduce((s, row) => s + row.spend, 0);

  // Daily
  const dailyAcc = new Map(listDates(range).map((date) => [date, emptyAccumulator()]));
  for (const order of included) {
    const acc = dailyAcc.get(order.orderDate);
    if (acc) addOrder(acc, order);
  }
  for (const row of spend) {
    const acc = dailyAcc.get(row.date);
    if (acc) acc.metaSpend += row.spend;
  }

  // Campaigns
  const campaignAcc = new Map<string, { acc: Accumulator; row: Omit<CampaignRow, keyof Totals> }>();
  const campaignEntry = (key: string, init: () => Omit<CampaignRow, keyof Totals>) => {
    let entry = campaignAcc.get(key);
    if (!entry) {
      entry = { acc: emptyAccumulator(), row: init() };
      campaignAcc.set(key, entry);
    }
    return entry;
  };
  // Creatives
  const creativeAcc = new Map<string, { acc: Accumulator; row: Omit<CreativeRow, keyof Totals> }>();
  const creativeEntry = (key: string, init: () => Omit<CreativeRow, keyof Totals>) => {
    let entry = creativeAcc.get(key);
    if (!entry) {
      entry = { acc: emptyAccumulator(), row: init() };
      creativeAcc.set(key, entry);
    }
    return entry;
  };

  for (const order of included) {
    const a = order.attribution;
    addOrder(
      campaignEntry(a.campaignKey, () => ({
        key: a.campaignKey,
        campaignId: a.campaignId,
        campaignName: a.campaignName,
        matchedToMeta: a.matchedToMeta,
        impressions: 0,
        clicks: 0,
        metaPurchases: 0,
      })).acc,
      order
    );
    addOrder(
      creativeEntry(a.creativeKey, () => ({
        key: a.creativeKey,
        creativeId: a.creativeId,
        creativeName: a.creativeName,
        campaignKey: a.campaignKey,
        campaignName: a.campaignName,
        adsetName: a.adsetName,
        matchedToMeta: a.matchedToMeta,
        impressions: 0,
        clicks: 0,
      })).acc,
      order
    );
  }

  for (const row of spend) {
    const campaignKey = `meta:${row.campaignId}`;
    const knownCampaign = ctx.meta.campaignsById.get(row.campaignId);
    const campaign = campaignEntry(campaignKey, () => ({
      key: campaignKey,
      campaignId: row.campaignId,
      campaignName: knownCampaign?.campaignName ?? row.campaignName ?? row.campaignId,
      matchedToMeta: true,
      impressions: 0,
      clicks: 0,
      metaPurchases: 0,
    }));
    campaign.acc.metaSpend += row.spend;
    campaign.row.impressions += row.impressions;
    campaign.row.clicks += row.clicks;
    campaign.row.metaPurchases += row.purchases;

    const creativeKey = `meta:${row.adId}`;
    const knownAd = ctx.meta.adsById.get(row.adId);
    const creative = creativeEntry(creativeKey, () => ({
      key: creativeKey,
      creativeId: row.adId,
      creativeName: knownAd?.adName ?? row.adName ?? row.adId,
      campaignKey,
      campaignName: campaign.row.campaignName,
      adsetName: knownAd?.adsetName ?? row.adsetName,
      matchedToMeta: true,
      impressions: 0,
      clicks: 0,
    }));
    creative.acc.metaSpend += row.spend;
    creative.row.impressions += row.impressions;
    creative.row.clicks += row.clicks;
  }

  // Shoes (+ ad spend allocated through each creative's attributed shoe units)
  const shoeAcc = new Map<string, Accumulator>();
  const shoeOrderSeen = new Map<string, Set<string>>();
  const creativeShoeUnits = new Map<string, Map<string, number>>();
  for (const order of included) {
    for (const line of order.lines) {
      if (!line.shoeName) continue;
      const acc = shoeAcc.get(line.shoeName) ?? emptyAccumulator();
      shoeAcc.set(line.shoeName, acc);
      const seen = shoeOrderSeen.get(line.shoeName) ?? new Set<string>();
      shoeOrderSeen.set(line.shoeName, seen);
      if (!seen.has(order.orderId)) {
        seen.add(order.orderId);
        acc.orders += 1;
      }
      acc.units += line.quantity;
      acc.grossRevenue += line.grossRevenue;
      acc.gst += line.gst;
      acc.netRevenue += line.netRevenue;
      acc.productCost += line.productCost;
      acc.shippingCost += line.shippingAllocated;

      const units = creativeShoeUnits.get(order.attribution.creativeKey) ?? new Map<string, number>();
      units.set(line.shoeName, (units.get(line.shoeName) ?? 0) + line.quantity);
      creativeShoeUnits.set(order.attribution.creativeKey, units);
    }
  }
  let unallocatedSpend = 0;
  const spendByCreative = new Map<string, number>();
  for (const row of spend) {
    const key = `meta:${row.adId}`;
    spendByCreative.set(key, (spendByCreative.get(key) ?? 0) + row.spend);
  }
  for (const [creativeKey, creativeSpend] of spendByCreative) {
    const units = creativeShoeUnits.get(creativeKey);
    const totalUnits = units ? [...units.values()].reduce((s, u) => s + u, 0) : 0;
    if (!units || totalUnits === 0) {
      unallocatedSpend += creativeSpend;
      continue;
    }
    for (const [shoeName, shoeUnits] of units) {
      const acc = shoeAcc.get(shoeName);
      if (acc) acc.metaSpend += (creativeSpend * shoeUnits) / totalUnits;
    }
  }
  const unallocated = metaCost(unallocatedSpend);

  // Health
  const unmapped = new Map<string, { productTitle: string; reason: UnmappedReason; units: number; orders: Set<string> }>();
  const priceMismatches: DataHealth["priceMismatches"] = [];
  for (const order of results) {
    for (const line of order.lines) {
      if (!line.shoeName && line.unmappedReason) {
        const entry = unmapped.get(line.productTitle) ?? {
          productTitle: line.productTitle,
          reason: line.unmappedReason,
          units: 0,
          orders: new Set<string>(),
        };
        entry.units += line.quantity;
        entry.orders.add(order.orderId);
        unmapped.set(line.productTitle, entry);
      } else if (
        order.included &&
        line.shoeName &&
        line.sellingPrice > 0 &&
        line.shopifyUnitPrice > 0 &&
        Math.abs(line.shopifyUnitPrice - line.sellingPrice) / line.sellingPrice > PRICE_MISMATCH_THRESHOLD &&
        priceMismatches.length < 50
      ) {
        priceMismatches.push({
          orderNumber: order.orderNumber,
          shoeName: line.shoeName,
          shopifyPrice: line.shopifyUnitPrice,
          sheetPrice: line.sellingPrice,
        });
      }
    }
  }
  const spendDates = new Set(spend.map((row) => row.date));
  const orderDates = new Set(included.map((order) => order.orderDate));
  const matched = included.filter((o) => o.attribution.matchedToMeta).length;

  const byPaymentType: Record<PaymentType, number> = { PREPAID: 0, COD: 0, PARTIAL_COD: 0, UNKNOWN: 0 };
  const byStatus: Record<string, number> = { PENDING: 0, DELIVERED: 0, RTO: 0, CANCELLED: 0 };
  for (const order of results) {
    byStatus[order.orderStatus] = (byStatus[order.orderStatus] ?? 0) + 1;
    if (order.included) byPaymentType[order.paymentType] += 1;
  }

  const sortedOrders = [...results].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const limit = options.orderLimit ?? 500;

  const byProfitDesc = <T extends Totals>(rows: T[]) => rows.sort((a, b) => b.metaCost - a.metaCost || b.profit - a.profit);

  return {
    range,
    totals: finalizeTotals(totalAcc),
    byPaymentType,
    byStatus,
    daily: [...dailyAcc.entries()].map(([date, acc]) => ({ date, ...finalizeTotals(acc) })),
    campaigns: byProfitDesc([...campaignAcc.values()].map(({ acc, row }) => ({ ...row, ...finalizeTotals(acc) }))),
    creatives: byProfitDesc([...creativeAcc.values()].map(({ acc, row }) => ({ ...row, ...finalizeTotals(acc) }))),
    shoes: [...shoeAcc.entries()]
      .map(([shoeName, acc]) => ({ shoeName, ...finalizeTotals(acc) }))
      .sort((a, b) => b.netRevenue - a.netRevenue),
    unallocatedAdSpend: {
      metaSpend: round2(unallocated.spend),
      metaGst: round2(unallocated.gst),
      metaCost: round2(unallocated.total),
    },
    orders: sortedOrders.slice(0, limit).map((order) => ({
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      orderDate: order.orderDate,
      createdAt: order.createdAt,
      paymentType: order.paymentType,
      orderStatus: order.orderStatus,
      included: order.included,
      exclusionReason: order.exclusionReason,
      shoes: [...new Set(order.lines.map((l) => l.shoeName ?? `UNMAPPED: ${l.productTitle}`))].join(", "),
      units: order.units,
      shopifyTotalPrice: round2(order.shopifyTotalPrice),
      grossRevenue: round2(order.grossRevenue),
      netRevenue: round2(order.netRevenue),
      productCost: round2(order.productCost),
      shippingCost: round2(order.shippingCost),
      profit: round2(order.profit),
      campaignName: order.attribution.campaignName,
      creativeName: order.attribution.creativeName,
      attributionMethod: order.attribution.method,
      matchedToMeta: order.attribution.matchedToMeta,
    })),
    ordersTotal: results.length,
    health: {
      unmappedProducts: [...unmapped.values()]
        .map((entry) => ({ productTitle: entry.productTitle, reason: entry.reason, units: entry.units, orders: entry.orders.size }))
        .sort((a, b) => b.units - a.units),
      excluded: {
        cancelled: results.filter((o) => o.exclusionReason === "CANCELLED").length,
        unknownPaymentType: results.filter((o) => o.exclusionReason === "UNKNOWN_PAYMENT_TYPE").length,
        noMappedItems: results.filter((o) => o.exclusionReason === "NO_MAPPED_ITEMS").length,
      },
      attribution: {
        matchedToMeta: matched,
        utmNotMatched: included.filter((o) => o.attribution.method === "utm_not_matched").length,
        campaignOnly: included.filter((o) => o.attribution.matchedToMeta && o.attribution.creativeId === null).length,
        unattributed: included.filter((o) => o.attribution.campaignKey === UNATTRIBUTED).length,
        coveragePercent: included.length > 0 ? round2((matched / included.length) * 100) : null,
      },
      datesWithOrdersButNoSpend: [...orderDates].filter((date) => !spendDates.has(date)).sort(),
      priceMismatches,
    },
  };
}

/** Small summary used for the Today / 7D / 15D / 30D profit strip. */
export function summarizeRange(ctx: ProfitContext, orders: EngineOrder[], spend: SpendRow[], range: DateRange): Totals {
  const acc = emptyAccumulator();
  for (const order of orders) {
    if (!isDateInRange(order.orderDate, range)) continue;
    const result = calculateOrderProfit(order, ctx);
    if (result.included) addOrder(acc, result);
  }
  acc.metaSpend = spend.filter((row) => isDateInRange(row.date, range)).reduce((s, row) => s + row.spend, 0);
  return finalizeTotals(acc);
}

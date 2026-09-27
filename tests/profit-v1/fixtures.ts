/**
 * Example economics from the V1 spec. Used ONLY by tests; nothing here is used by the app.
 */
import { normalizeName } from "@/lib/profit-v1/names";
import type { EngineOrder, MetaCampaign, MetaCreative, RawAttribution, ShoeConfig, SpendRow } from "@/lib/profit-v1/types";

export function shoe(name: string, values: Omit<ShoeConfig, "shoeName" | "normalizedName" | "gstPercent"> & { gstPercent?: number | null }): ShoeConfig {
  const { gstPercent = null, ...rest } = values as typeof values & { shoeName?: string; normalizedName?: string };
  delete (rest as { shoeName?: string }).shoeName;
  delete (rest as { normalizedName?: string }).normalizedName;
  return { ...rest, gstPercent, shoeName: name, normalizedName: normalizeName(name) };
}

export const NEPOLIAN = shoe("Nepolian Clog", {
  prepaidSellingPrice: 1499,
  codOrPartialSellingPrice: 1399,
  productCost: 350,
  prepaidShippingCost: 80,
  codShippingCost: 105,
  prepaidDeliveryPercent: 95,
  codOrPartialDeliveryPercent: 85,
});

export const ZENWALKERS = shoe("Zenwalkers Signature Shoes", {
  prepaidSellingPrice: 1499,
  codOrPartialSellingPrice: 1299,
  productCost: 320,
  prepaidShippingCost: 80,
  codShippingCost: 105,
  prepaidDeliveryPercent: 96,
  codOrPartialDeliveryPercent: 84,
});

export const BARESTEP = shoe("Barestep", {
  prepaidSellingPrice: 999,
  codOrPartialSellingPrice: 899,
  productCost: 250,
  prepaidShippingCost: 80,
  codShippingCost: 105,
  prepaidDeliveryPercent: 94,
  codOrPartialDeliveryPercent: 82,
});

export const CONFIGS = [NEPOLIAN, ZENWALKERS, BARESTEP];

export const NO_ATTRIBUTION: RawAttribution = {
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmContent: null,
  utmTerm: null,
  utmId: null,
  metaCampaignId: null,
  metaAdsetId: null,
  metaAdId: null,
};

let counter = 0;
export function order(
  overrides: Omit<Partial<EngineOrder>, "attribution"> & { title?: string; quantity?: number; attribution?: Partial<RawAttribution> } = {}
): EngineOrder {
  counter += 1;
  const { title, quantity, attribution, ...rest } = overrides;
  return {
    id: `order-${counter}`,
    orderNumber: String(1000 + counter),
    orderDate: "2026-09-26",
    createdAt: `2026-09-26T0${counter % 10}:00:00.000Z`,
    paymentType: "PREPAID",
    orderStatus: "DELIVERED",
    totalPrice: 1499,
    items: [
      {
        productTitle: title ?? "Nepolian Clog",
        variantTitle: null,
        lineName: null,
        quantity: quantity ?? 1,
        unitPrice: 1499,
      },
    ],
    ...rest,
    attribution: { ...NO_ATTRIBUTION, ...attribution },
  };
}

// Meta: Campaign "Zenwalkers Scale" → ad "Video Hook 03"
export const CAMPAIGN_ID = "120000000000100";
export const AD_ID = "120000000000001";
export const AD_ID_2 = "120000000000002";
export const CREATIVES: MetaCreative[] = [
  { adId: AD_ID, adName: "Video Hook 03", adsetId: "120000000000050", adsetName: "Broad 18-45", campaignId: CAMPAIGN_ID, campaignName: "Zenwalkers Scale" },
  { adId: AD_ID_2, adName: "Static 01", adsetId: "120000000000050", adsetName: "Broad 18-45", campaignId: CAMPAIGN_ID, campaignName: "Zenwalkers Scale" },
];
export const CAMPAIGNS: MetaCampaign[] = [
  { campaignId: CAMPAIGN_ID, campaignName: "Zenwalkers Scale" },
  { campaignId: "120000000000200", campaignName: "Clog Broad" },
];

export function spend(date: string, adId: string, amount: number, campaignId = CAMPAIGN_ID): SpendRow {
  return {
    date,
    campaignId,
    campaignName: null,
    adsetId: null,
    adsetName: null,
    adId,
    adName: null,
    spend: amount,
    impressions: 1000,
    clicks: 20,
    purchases: 1,
  };
}

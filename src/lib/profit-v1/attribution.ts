/**
 * Order → Campaign → Creative attribution. Uses only data that came with the order.
 * Never guesses, never spreads orders across campaigns.
 *
 * Priority:
 *  1. Meta ad ID           (explicit ad id, or utm_content that is a numeric Meta id)
 *  2. Meta campaign ID     (explicit campaign id, or numeric utm_campaign / utm_id)
 *  3. utm_content          = exact (normalized) Meta ad name
 *  4. utm_campaign         = exact (normalized) Meta campaign name
 *  5. Other UTM data       shown as-is, marked "not matched to Meta" (no spend)
 *  6. Nothing              → UNATTRIBUTED
 */
import { normalizeName } from "./names";
import type { MetaCampaign, MetaCreative, RawAttribution } from "./types";

export const UNATTRIBUTED = "UNATTRIBUTED";

export type AttributionMethod =
  | "meta_ad_id"
  | "meta_campaign_id"
  | "utm_content_name"
  | "utm_campaign_name"
  | "utm_not_matched"
  | "unattributed";

export interface ResolvedAttribution {
  method: AttributionMethod;
  /** true when campaign (and creative, if any) exist in synced Meta data */
  matchedToMeta: boolean;
  campaignKey: string;
  campaignId: string | null;
  campaignName: string;
  creativeKey: string;
  creativeId: string | null;
  creativeName: string;
  adsetId: string | null;
  adsetName: string | null;
}

export interface MetaIndex {
  adsById: Map<string, MetaCreative>;
  campaignsById: Map<string, MetaCampaign>;
  adsByName: Map<string, MetaCreative[]>;
  campaignsByName: Map<string, MetaCampaign[]>;
}

const META_ID_PATTERN = /^\d{6,}$/;

export function isMetaId(value: string | null | undefined): value is string {
  return typeof value === "string" && META_ID_PATTERN.test(value.trim());
}

export function buildMetaIndex(creatives: MetaCreative[], campaigns: MetaCampaign[]): MetaIndex {
  const adsById = new Map<string, MetaCreative>();
  const campaignsById = new Map<string, MetaCampaign>();
  const adsByName = new Map<string, MetaCreative[]>();
  const campaignsByName = new Map<string, MetaCampaign[]>();

  const addCampaign = (campaign: MetaCampaign) => {
    if (!campaign.campaignId || campaignsById.has(campaign.campaignId)) return;
    campaignsById.set(campaign.campaignId, campaign);
    const key = normalizeName(campaign.campaignName);
    if (key) campaignsByName.set(key, [...(campaignsByName.get(key) ?? []), campaign]);
  };

  for (const campaign of campaigns) addCampaign(campaign);
  for (const creative of creatives) {
    adsById.set(creative.adId, creative);
    const key = normalizeName(creative.adName);
    if (key) adsByName.set(key, [...(adsByName.get(key) ?? []), creative]);
    if (creative.campaignId) {
      addCampaign({ campaignId: creative.campaignId, campaignName: creative.campaignName ?? creative.campaignId });
    }
  }
  return { adsById, campaignsById, adsByName, campaignsByName };
}

function fromCreative(creative: MetaCreative, index: MetaIndex, method: AttributionMethod): ResolvedAttribution {
  const campaign = creative.campaignId ? index.campaignsById.get(creative.campaignId) : undefined;
  const campaignId = creative.campaignId ?? null;
  return {
    method,
    matchedToMeta: true,
    campaignKey: campaignId ? `meta:${campaignId}` : UNATTRIBUTED,
    campaignId,
    campaignName: campaign?.campaignName ?? creative.campaignName ?? UNATTRIBUTED,
    creativeKey: `meta:${creative.adId}`,
    creativeId: creative.adId,
    creativeName: creative.adName,
    adsetId: creative.adsetId,
    adsetName: creative.adsetName,
  };
}

function fromCampaign(campaign: MetaCampaign, method: AttributionMethod): ResolvedAttribution {
  const campaignKey = `meta:${campaign.campaignId}`;
  return {
    method,
    matchedToMeta: true,
    campaignKey,
    campaignId: campaign.campaignId,
    campaignName: campaign.campaignName,
    creativeKey: `${UNATTRIBUTED}:${campaignKey}`,
    creativeId: null,
    creativeName: UNATTRIBUTED,
    adsetId: null,
    adsetName: null,
  };
}

function uniqueByName<T>(map: Map<string, T[]>, value: string | null): T | null {
  const key = normalizeName(value);
  if (!key) return null;
  const hits = map.get(key) ?? [];
  return hits.length === 1 ? hits[0] : null;
}

export function resolveAttribution(raw: RawAttribution, index: MetaIndex): ResolvedAttribution {
  // 1. Meta ad id
  const adIdCandidates = [raw.metaAdId, isMetaId(raw.utmContent) ? raw.utmContent : null];
  for (const candidate of adIdCandidates) {
    const creative = candidate ? index.adsById.get(candidate.trim()) : undefined;
    if (creative) return fromCreative(creative, index, "meta_ad_id");
  }

  // 2. Meta campaign id
  const campaignIdCandidates = [
    raw.metaCampaignId,
    isMetaId(raw.utmCampaign) ? raw.utmCampaign : null,
    isMetaId(raw.utmId) ? raw.utmId : null,
  ];
  for (const candidate of campaignIdCandidates) {
    const campaign = candidate ? index.campaignsById.get(candidate.trim()) : undefined;
    if (campaign) {
      // Campaign ID matched: still try utm_content as an ad name inside that campaign
      // (common Meta URL template: utm_campaign={{campaign.id}}&utm_content={{ad.name}}).
      const contentKey = normalizeName(raw.utmContent);
      const inCampaign = contentKey
        ? (index.adsByName.get(contentKey) ?? []).filter((ad) => ad.campaignId === campaign.campaignId)
        : [];
      if (inCampaign.length === 1) return fromCreative(inCampaign[0], index, "meta_campaign_id");
      return fromCampaign(campaign, "meta_campaign_id");
    }
  }

  // 3. utm_content = exact ad name (must be unique; if not, narrow by campaign)
  const contentKey = normalizeName(raw.utmContent);
  if (contentKey) {
    const hits = index.adsByName.get(contentKey) ?? [];
    let creative: MetaCreative | null = hits.length === 1 ? hits[0] : null;
    if (!creative && hits.length > 1) {
      const campaignKey = normalizeName(raw.utmCampaign);
      const narrowed = hits.filter(
        (hit) =>
          (hit.campaignId && hit.campaignId === raw.utmCampaign?.trim()) ||
          (campaignKey && normalizeName(hit.campaignName) === campaignKey)
      );
      creative = narrowed.length === 1 ? narrowed[0] : null;
    }
    if (creative) return fromCreative(creative, index, "utm_content_name");
  }

  // 4. utm_campaign = exact campaign name
  const campaign = uniqueByName(index.campaignsByName, raw.utmCampaign);
  if (campaign) return fromCampaign(campaign, "utm_campaign_name");

  // 5. UTM present but not found in Meta data: keep it visible, never guess
  const campaignLabel = raw.utmCampaign?.trim();
  if (campaignLabel) {
    const campaignKey = `utm:${normalizeName(campaignLabel)}`;
    const contentLabel = raw.utmContent?.trim();
    return {
      method: "utm_not_matched",
      matchedToMeta: false,
      campaignKey,
      campaignId: null,
      campaignName: campaignLabel,
      creativeKey: contentLabel ? `utm:${normalizeName(campaignLabel)}:${normalizeName(contentLabel)}` : `${UNATTRIBUTED}:${campaignKey}`,
      creativeId: null,
      creativeName: contentLabel || UNATTRIBUTED,
      adsetId: null,
      adsetName: null,
    };
  }

  // 6. Nothing usable
  return {
    method: "unattributed",
    matchedToMeta: false,
    campaignKey: UNATTRIBUTED,
    campaignId: null,
    campaignName: UNATTRIBUTED,
    creativeKey: UNATTRIBUTED,
    creativeId: null,
    creativeName: UNATTRIBUTED,
    adsetId: null,
    adsetName: null,
  };
}

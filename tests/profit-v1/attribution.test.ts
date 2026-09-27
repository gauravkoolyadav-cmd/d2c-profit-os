import { describe, expect, it } from "vitest";
import { buildMetaIndex, resolveAttribution, UNATTRIBUTED } from "@/lib/profit-v1/attribution";
import { AD_ID, CAMPAIGN_ID, CAMPAIGNS, CREATIVES, NO_ATTRIBUTION } from "./fixtures";

const index = buildMetaIndex(CREATIVES, CAMPAIGNS);
const resolve = (raw: Partial<typeof NO_ATTRIBUTION>) => resolveAttribution({ ...NO_ATTRIBUTION, ...raw }, index);

describe("order → campaign → creative attribution", () => {
  it("1. Meta ad ID gives creative AND campaign", () => {
    const a = resolve({ metaAdId: AD_ID });
    expect(a).toMatchObject({
      method: "meta_ad_id",
      matchedToMeta: true,
      campaignId: CAMPAIGN_ID,
      campaignName: "Zenwalkers Scale",
      creativeId: AD_ID,
      creativeName: "Video Hook 03",
      adsetName: "Broad 18-45",
    });
  });

  it("numeric utm_content is treated as the Meta ad ID", () => {
    expect(resolve({ utmContent: AD_ID })).toMatchObject({ method: "meta_ad_id", creativeName: "Video Hook 03" });
  });

  it("2. Meta campaign ID gives the campaign; creative stays UNATTRIBUTED", () => {
    const a = resolve({ metaCampaignId: "120000000000200" });
    expect(a).toMatchObject({ method: "meta_campaign_id", campaignName: "Clog Broad", creativeName: UNATTRIBUTED });
  });

  it("3. utm_content = exact ad name", () => {
    expect(resolve({ utmCampaign: "Zenwalkers Scale", utmContent: "video hook 03" })).toMatchObject({
      method: "utm_content_name",
      creativeId: AD_ID,
      campaignId: CAMPAIGN_ID,
    });
  });

  it("4. utm_campaign = exact campaign name", () => {
    expect(resolve({ utmCampaign: "Clog Broad" })).toMatchObject({
      method: "utm_campaign_name",
      campaignId: "120000000000200",
      creativeName: UNATTRIBUTED,
    });
  });

  it("ad ID beats campaign name (priority order)", () => {
    expect(resolve({ metaAdId: AD_ID, utmCampaign: "Clog Broad" }).method).toBe("meta_ad_id");
  });

  it("UTM campaign not found in Meta is kept visible, not matched and not guessed", () => {
    const a = resolve({ utmCampaign: "Diwali Sale", utmContent: "Reel 7" });
    expect(a).toMatchObject({ method: "utm_not_matched", matchedToMeta: false, campaignName: "Diwali Sale", creativeName: "Reel 7" });
  });

  it("no attribution → UNATTRIBUTED campaign and creative", () => {
    expect(resolve({})).toMatchObject({
      method: "unattributed",
      campaignKey: UNATTRIBUTED,
      campaignName: UNATTRIBUTED,
      creativeName: UNATTRIBUTED,
    });
  });

  it("an unknown ad ID is never matched to a random ad", () => {
    expect(resolve({ metaAdId: "999999999999" }).method).toBe("unattributed");
  });
});

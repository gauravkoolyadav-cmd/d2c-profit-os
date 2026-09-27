// Meta (Facebook/Instagram) Marketing API Client
export interface MetaConfig {
  accessToken: string;
  apiVersion?: string;
}

export interface MetaAdAccount {
  account_id: string;
  account_status: number;
  name: string;
}

export interface MetaCampaign {
  id: string;
  account_id: string;
  name: string;
  status: string;
  objective: string;
  daily_budget: string | null;
  lifetime_budget: string | null;
  created_time: string;
  updated_time: string;
}

export interface MetaAdSet {
  id: string;
  account_id: string;
  campaign_id: string;
  name: string;
  status: string;
  created_time: string;
  updated_time: string;
}

export interface MetaAd {
  id: string;
  account_id: string;
  adset_id: string;
  name: string;
  status: string;
  creative: {
    thumbnail_url: string;
  };
  created_time: string;
  updated_time: string;
}

export interface MetaInsights {
  account_id: string;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  date_start: string;
  date_stop: string;
  spend: number;
  impressions: number;
  clicks: number;
  actions: Array<Record<string, any>>;
}

export class MetaClient {
  private config: MetaConfig;
  private apiVersion: string;

  constructor(config: MetaConfig) {
    this.config = config;
    this.apiVersion = config.apiVersion || "v19.0";
  }

  private async request<T>(
    endpoint: string,
    params?: Record<string, string>
  ): Promise<T> {
    const searchParams = new URLSearchParams(params);
    const url = `https://graph.facebook.com/${this.apiVersion}${endpoint}?${searchParams.toString()}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Meta API error: ${response.status} ${response.statusText} - ${error}`
      );
    }

    return response.json();
  }

  async getAdAccounts(): Promise<MetaAdAccount[]> {
    const response = await this.request<{ data: MetaAdAccount[] }>(
      "/me/adaccounts",
      { fields: "account_id,name,account_status" }
    );
    return response.data;
  }

  async getCampaigns(adAccountId: string): Promise<MetaCampaign[]> {
    const response = await this.request<{ data: MetaCampaign[] }>(
      `/act_${adAccountId}/campaigns`,
      {
        fields:
          "id,name,status,objective,daily_budget,lifetime_budget,created_time,updated_time",
      }
    );
    return response.data;
  }

  async getAdSets(campaignId: string): Promise<MetaAdSet[]> {
    const response = await this.request<{ data: MetaAdSet[] }>(
      `/${campaignId}/adsets`,
      {
        fields: "id,account_id,campaign_id,name,status,created_time,updated_time",
      }
    );
    return response.data;
  }

  async getAds(adSetId: string): Promise<MetaAd[]> {
    const response = await this.request<{ data: MetaAd[] }>(
      `/${adSetId}/ads`,
      {
        fields:
          "id,account_id,adset_id,name,status,creative{thumbnail_url},created_time,updated_time",
      }
    );
    return response.data;
  }

  async getInsights(
    level: "account" | "campaign" | "adset" | "ad",
    id: string,
    dateStart: string,
    dateEnd: string
  ): Promise<MetaInsights[]> {
    const response = await this.request<{ data: MetaInsights[] }>(
      `/${id}/insights`,
      {
        fields:
          "account_id,campaign_id,adset_id,ad_id,date_start,date_stop,spend,impressions,clicks,actions",
        time_range: `since_${dateStart}_until_${dateEnd}`,
        time_increment: "1",
        level,
        attribution_windows: "7d_click",
        default_summary: "true",
      }
    );
    return response.data;
  }

  // ── V1 profit dashboard: ad-level data with paging ───────────────────────

  private async fetchAllPages<T>(
    endpoint: string,
    params: Record<string, string>,
    maxPages = 50
  ): Promise<T[]> {
    const results: T[] = [];
    let page = await this.request<{ data: T[]; paging?: { next?: string } }>(endpoint, params);
    results.push(...page.data);
    let pages = 1;
    while (page.paging?.next && pages < maxPages) {
      const response = await fetch(page.paging.next, {
        headers: { Authorization: `Bearer ${this.config.accessToken}` },
      });
      if (!response.ok) {
        throw new Error(`Meta API error: ${response.status} ${response.statusText} - ${await response.text()}`);
      }
      page = await response.json();
      results.push(...page.data);
      pages += 1;
    }
    return results;
  }

  /** Every campaign in the account (id + name), including paused ones. */
  async listCampaigns(adAccountId: string): Promise<Array<{ id: string; name: string; status?: string }>> {
    return this.fetchAllPages(`/act_${normalizeAccountId(adAccountId)}/campaigns`, {
      fields: "id,name,status",
      limit: "500",
    });
  }

  /** Every ad (creative) with its ad set and campaign. */
  async listAdsWithHierarchy(adAccountId: string): Promise<MetaAdWithHierarchy[]> {
    return this.fetchAllPages(`/act_${normalizeAccountId(adAccountId)}/ads`, {
      fields: "id,name,status,adset{id,name},campaign{id,name},creative{id,name,thumbnail_url}",
      limit: "500",
    });
  }

  /** Daily spend per ad for a date range (dates are in the ad account timezone). */
  async getAdDailyInsights(adAccountId: string, since: string, until: string): Promise<MetaAdDailyInsight[]> {
    return this.fetchAllPages(`/act_${normalizeAccountId(adAccountId)}/insights`, {
      level: "ad",
      time_increment: "1",
      time_range: JSON.stringify({ since, until }),
      fields: "date_start,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,actions",
      limit: "500",
    });
  }

  // Convert Meta actions to conversions
  static getConversionCount(insights: MetaInsights): number {
    // Action type for purchases
    const purchaseAction = insights.actions?.find(
      (a) => a.action_type === "offsite_conversion.fb_pixel_purchase"
    );
    return purchaseAction?.value || 0;
  }

  static calculateCTR(insights: MetaInsights): number {
    if (!insights.impressions) return 0;
    return (insights.clicks / insights.impressions) * 100;
  }

  static calculateCPC(insights: MetaInsights): number {
    if (!insights.clicks) return 0;
    return insights.spend / insights.clicks;
  }

  static calculateCPM(insights: MetaInsights): number {
    if (!insights.impressions) return 0;
    return (insights.spend / insights.impressions) * 1000;
  }
}

export interface MetaAdWithHierarchy {
  id: string;
  name: string;
  status?: string;
  adset?: { id: string; name: string };
  campaign?: { id: string; name: string };
  creative?: { id: string; name?: string; thumbnail_url?: string };
}

export interface MetaAdDailyInsight {
  date_start: string;
  campaign_id: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: Array<{ action_type: string; value: string }>;
}

/** Accepts "act_123" or "123". */
export function normalizeAccountId(adAccountId: string): string {
  return adAccountId.trim().replace(/^act_/, "");
}

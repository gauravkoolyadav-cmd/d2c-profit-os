import { vi, type Mock } from "vitest";
import * as profit from "@/lib/profit/calculations";
import * as overview from "@/lib/dashboard/overview";
import * as ai from "@/lib/ai/analysis";
import * as attribution from "@/lib/attribution/tracking";
import * as payments from "@/lib/payments/management";
import * as polar from "@/lib/payments/polar";
import * as telegram from "@/lib/telegram/notifications";
import * as capi from "@/lib/capi/meta";
import * as adsSync from "@/lib/platforms/ads/sync";
import * as shopify from "@/lib/platforms/shopify";
import * as metaClient from "@/lib/platforms/meta/client";
import * as googleClient from "@/lib/platforms/google/client";
import * as snapchatClient from "@/lib/platforms/snapchat/client";
import * as tiktokClient from "@/lib/platforms/tiktok/client";
import * as profitJobs from "@/lib/profit-v1/jobs";

const MODULES: Record<string, Record<string, unknown>> = {
  profit, overview, ai, attribution, payments, polar, telegram, capi, adsSync,
  shopify, metaClient, googleClient, snapchatClient, tiktokClient, profitJobs,
};

/** Every mocked service / platform-client function, keyed "module.export". */
export function allServiceMocks(): Array<[string, Mock]> {
  const result: Array<[string, Mock]> = [];
  for (const [moduleName, mod] of Object.entries(MODULES)) {
    for (const [exportName, value] of Object.entries(mod)) {
      if (vi.isMockFunction(value)) result.push([`${moduleName}.${exportName}`, value as Mock]);
    }
  }
  return result;
}

/** Names of service functions that were called at all during the test. */
export function calledServices(): string[] {
  return allServiceMocks()
    .filter(([, mock]) => mock.mock.calls.length > 0)
    .map(([name]) => name);
}

/** Service calls whose arguments mention the given brand id anywhere. */
export function serviceCallsMentioning(brandId: string): string[] {
  return allServiceMocks()
    .filter(([, mock]) => mock.mock.calls.some((args) => JSON.stringify(args).includes(brandId)))
    .map(([name]) => name);
}

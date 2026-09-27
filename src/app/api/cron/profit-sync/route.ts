import { NextResponse } from "next/server";
import { safeCompare } from "@/lib/utils/timing-safe";
import { syncMetaForBrand, syncSheetForBrand, syncShopifyForBrand, type JobResult } from "@/lib/profit-v1/jobs";
import { brandIdsWithActiveConnection, brandIdsWithSheet } from "@/lib/profit-v1/repository";

export const maxDuration = 300;

const JOBS = ["sheet", "meta", "shopify", "all"] as const;
type Job = (typeof JOBS)[number];

/**
 * Scheduled sync for every brand. Protected by CRON_SECRET (Authorization: Bearer <secret>).
 * ?job=sheet (every 15 min) | meta (every 15–30 min) | shopify (catch-up, hourly) | all
 */
async function run(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!safeCompare(token, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const job = (new URL(req.url).searchParams.get("job") ?? "all") as Job;
  if (!(JOBS as readonly string[]).includes(job)) {
    return NextResponse.json({ error: "Unknown job" }, { status: 400 });
  }

  const results: Record<string, Record<string, JobResult>> = {};
  const record = (kind: string, brandId: string, result: JobResult) => {
    results[kind] = { ...(results[kind] ?? {}), [brandId]: result };
  };

  if (job === "sheet" || job === "all") {
    for (const brandId of await brandIdsWithSheet()) record("sheet", brandId, await syncSheetForBrand(brandId, "cron"));
  }
  if (job === "meta" || job === "all") {
    for (const brandId of await brandIdsWithActiveConnection("meta")) {
      record("meta", brandId, await syncMetaForBrand(brandId, { days: 3 }));
    }
  }
  if (job === "shopify" || job === "all") {
    for (const brandId of await brandIdsWithActiveConnection("shopify")) {
      record("shopify", brandId, await syncShopifyForBrand(brandId, { hours: 3 }));
    }
  }

  return NextResponse.json({ job, results });
}

export const GET = run;
export const POST = run;

/**
 * Table of every brand-scoped API endpoint, its minimum role, and the data
 * category it exposes. Used by the authorization matrix and the cross-tenant
 * regression suite.
 */
import { NextRequest } from "next/server";
import type { BrandRole } from "@/lib/auth/roles";
import { SUBSCRIPTION_A } from "./world";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/**
 * Data categories from the V1 security requirements. The current codebase has
 * no dedicated /orders, /campaigns or /products endpoints; that data is exposed
 * through the routes tagged below (profit, sync, AI, Shopify sync).
 */
export type DataCategory =
  | "dashboard/profit"
  | "orders"
  | "campaigns"
  | "products"
  | "integrations"
  | "settings"
  | "billing";

// Route handlers declare their own param shapes ({ id } or { brandId }); the
// test harness passes the matching shape at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: NextRequest, ctx: { params: Promise<any> }) => Promise<Response>;
type RouteModule = Partial<Record<HttpMethod, Handler>>;

export interface BrandRoute {
  name: string;
  method: HttpMethod;
  load: () => Promise<RouteModule>;
  /** URL path segment param name (usually "id"). */
  paramName?: "id" | "brandId";
  path: (brandId: string) => string;
  query?: string;
  body?: unknown;
  minRole: BrandRole;
  categories: DataCategory[];
}

const b = (brandId: string) => `/api/brands/${brandId}`;

// Explicit loaders: bundlers cannot resolve aliased dynamic imports with variables.
const CONNECTION_LOADERS: Record<string, () => Promise<RouteModule>> = {
  shopify: () => import("@/app/api/brands/[id]/connections/shopify/route"),
  meta: () => import("@/app/api/brands/[id]/connections/meta/route"),
  google: () => import("@/app/api/brands/[id]/connections/google/route"),
  snapchat: () => import("@/app/api/brands/[id]/connections/snapchat/route"),
  tiktok: () => import("@/app/api/brands/[id]/connections/tiktok/route"),
};

export const BRAND_ROUTES: BrandRoute[] = [
  // ── Settings ────────────────────────────────────────────────────────────
  { name: "GET brands/[id]", method: "GET", load: () => import("@/app/api/brands/[id]/route"), path: b, minRole: "viewer", categories: ["settings"] },
  { name: "PUT brands/[id]", method: "PUT", load: () => import("@/app/api/brands/[id]/route"), path: b, body: { name: "Renamed Brand" }, minRole: "manager", categories: ["settings"] },
  { name: "DELETE brands/[id]", method: "DELETE", load: () => import("@/app/api/brands/[id]/route"), path: b, minRole: "owner", categories: ["settings"] },
  { name: "GET notifications", method: "GET", load: () => import("@/app/api/brands/[id]/notifications/route"), path: (id) => `${b(id)}/notifications`, minRole: "viewer", categories: ["settings"] },
  { name: "PUT notifications", method: "PUT", load: () => import("@/app/api/brands/[id]/notifications/route"), path: (id) => `${b(id)}/notifications`, body: { enabled: true }, minRole: "manager", categories: ["settings"] },
  { name: "DELETE notifications", method: "DELETE", load: () => import("@/app/api/brands/[id]/notifications/route"), path: (id) => `${b(id)}/notifications`, minRole: "manager", categories: ["settings"] },
  { name: "POST notifications/test", method: "POST", load: () => import("@/app/api/brands/[id]/notifications/test/route"), path: (id) => `${b(id)}/notifications/test`, body: { chatId: "12345" }, minRole: "manager", categories: ["settings"] },
  { name: "GET notifications/logs", method: "GET", load: () => import("@/app/api/brands/[id]/notifications/logs/route"), path: (id) => `${b(id)}/notifications/logs`, minRole: "viewer", categories: ["settings"] },

  // ── Dashboard / profit ─────────────────────────────────────────────────
  { name: "GET profit", method: "GET", load: () => import("@/app/api/brands/[id]/profit/route"), path: (id) => `${b(id)}/profit`, query: "granularity=daily&includeBreakdown=true", minRole: "viewer", categories: ["dashboard/profit", "orders"] },
  { name: "GET dashboard/[brandId]/overview", method: "GET", load: () => import("@/app/api/dashboard/[brandId]/overview/route"), paramName: "brandId", path: (id) => `/api/dashboard/${id}/overview`, minRole: "viewer", categories: ["dashboard/profit", "orders", "campaigns"] },
  { name: "GET ai", method: "GET", load: () => import("@/app/api/brands/[id]/ai/route"), path: (id) => `${b(id)}/ai`, minRole: "viewer", categories: ["dashboard/profit", "campaigns"] },
  { name: "GET attribution", method: "GET", load: () => import("@/app/api/brands/[id]/attribution/route"), path: (id) => `${b(id)}/attribution`, minRole: "viewer", categories: ["dashboard/profit", "campaigns"] },

  // ── Orders / products (Shopify) ────────────────────────────────────────
  { name: "POST sync/shopify (orders)", method: "POST", load: () => import("@/app/api/brands/[id]/sync/shopify/route"), path: (id) => `${b(id)}/sync/shopify`, body: { type: "orders" }, minRole: "manager", categories: ["orders"] },
  { name: "POST sync/shopify (products)", method: "POST", load: () => import("@/app/api/brands/[id]/sync/shopify/route"), path: (id) => `${b(id)}/sync/shopify`, body: { type: "products" }, minRole: "manager", categories: ["products"] },

  // ── Campaigns (ad platforms) ───────────────────────────────────────────
  { name: "GET sync", method: "GET", load: () => import("@/app/api/brands/[id]/sync/route"), path: (id) => `${b(id)}/sync`, minRole: "viewer", categories: ["campaigns", "integrations"] },
  { name: "POST sync", method: "POST", load: () => import("@/app/api/brands/[id]/sync/route"), path: (id) => `${b(id)}/sync`, body: { platform: "meta", date: "2026-09-01" }, minRole: "manager", categories: ["campaigns"] },
  { name: "GET capi", method: "GET", load: () => import("@/app/api/brands/[id]/capi/route"), path: (id) => `${b(id)}/capi`, minRole: "viewer", categories: ["campaigns", "integrations"] },
  { name: "POST capi/send", method: "POST", load: () => import("@/app/api/brands/[id]/capi/send/route"), path: (id) => `${b(id)}/capi/send`, body: { eventType: "Lead", userData: {} }, minRole: "manager", categories: ["campaigns", "integrations"] },

  // ── Integrations (platform connections) ────────────────────────────────
  ...(
    [
      ["shopify", { storeDomain: "demo.myshopify.com", accessToken: "shpat_x" }],
      ["meta", { accessToken: "EAAB", accountId: "123" }],
      ["google", { developerToken: "d", clientId: "c", clientSecret: "s", refreshToken: "r", customerId: "1" }],
      ["snapchat", { clientId: "c", clientSecret: "s", accessToken: "a" }],
      ["tiktok", { appId: "a", appSecret: "s", accessToken: "t" }],
    ] as const
  ).flatMap(([platform, body]): BrandRoute[] => {
    const load = CONNECTION_LOADERS[platform];
    const path = (id: string) => `${b(id)}/connections/${platform}`;
    return [
      { name: `GET connections/${platform}`, method: "GET", load, path, minRole: "viewer", categories: ["integrations"] },
      { name: `POST connections/${platform}`, method: "POST", load, path, body, minRole: "manager", categories: ["integrations"] },
      { name: `DELETE connections/${platform}`, method: "DELETE", load, path, minRole: "owner", categories: ["integrations"] },
    ];
  }),

  // ── V1 profit dashboard ────────────────────────────────────────────────
  { name: "GET profit-dashboard", method: "GET", load: () => import("@/app/api/brands/[id]/profit-dashboard/route"), path: (id) => `${b(id)}/profit-dashboard`, query: "range=30d", minRole: "viewer", categories: ["dashboard/profit", "orders", "campaigns", "products"] },
  { name: "POST profit-dashboard/sync", method: "POST", load: () => import("@/app/api/brands/[id]/profit-dashboard/sync/route"), path: (id) => `${b(id)}/profit-dashboard/sync`, body: { source: "meta" }, minRole: "manager", categories: ["integrations", "campaigns", "orders"] },
  { name: "GET profit-dashboard/settings", method: "GET", load: () => import("@/app/api/brands/[id]/profit-dashboard/settings/route"), path: (id) => `${b(id)}/profit-dashboard/settings`, minRole: "viewer", categories: ["settings"] },
  { name: "PUT profit-dashboard/settings", method: "PUT", load: () => import("@/app/api/brands/[id]/profit-dashboard/settings/route"), path: (id) => `${b(id)}/profit-dashboard/settings`, body: { defaultProductGstPercent: 5 }, minRole: "manager", categories: ["settings"] },

  // ── Billing ────────────────────────────────────────────────────────────
  { name: "POST billing/checkout", method: "POST", load: () => import("@/app/api/brands/[id]/billing/checkout/route"), path: (id) => `${b(id)}/billing/checkout`, body: { tier: "starter", userEmail: "owner@test.local" }, minRole: "owner", categories: ["billing", "settings"] },
  { name: "GET billing/subscription", method: "GET", load: () => import("@/app/api/brands/[id]/billing/subscription/route"), path: (id) => `${b(id)}/billing/subscription`, minRole: "viewer", categories: ["billing", "settings"] },
  { name: "DELETE billing/subscription", method: "DELETE", load: () => import("@/app/api/brands/[id]/billing/subscription/route"), path: (id) => `${b(id)}/billing/subscription`, body: { subscriptionId: SUBSCRIPTION_A }, minRole: "owner", categories: ["billing", "settings"] },
  { name: "GET billing/invoices", method: "GET", load: () => import("@/app/api/brands/[id]/billing/invoices/route"), path: (id) => `${b(id)}/billing/invoices`, minRole: "viewer", categories: ["billing", "settings"] },
];

/** Invoke a brand route handler directly with a synthetic request. */
export async function callRoute(route: BrandRoute, brandId: string, bodyOverride?: unknown): Promise<Response> {
  const mod = await route.load();
  const handler = mod[route.method];
  if (!handler) throw new Error(`${route.name}: no ${route.method} handler exported`);

  const url = `http://localhost${route.path(brandId)}${route.query ? `?${route.query}` : ""}`;
  const body = bodyOverride ?? route.body;
  const init: RequestInit = { method: route.method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  } else if (route.method !== "GET") {
    init.body = JSON.stringify({});
    init.headers = { "content-type": "application/json" };
  }

  const request = new NextRequest(url, init as ConstructorParameters<typeof NextRequest>[1]);
  const params = Promise.resolve({ [route.paramName ?? "id"]: brandId });
  return handler(request, { params });
}

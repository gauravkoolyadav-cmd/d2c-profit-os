# V1 Simple Profit Architecture: D2C Profit Dashboard

| | |
|---|---|
| **Status** | PROPOSAL, awaiting your approval. **No code, schema or database changes have been made.** |
| **Branch** | `v1-foundation` |
| **Date** | 27 Sep 2026 |
| **Replaces** | For V1, this replaces the 57-table plan in `audits/v1-database-design.md` (kept only as a long-term reference). |

**Goal**

```
Shopify order → saved → shoe identified → campaign + creative identified
             → Google Sheet gives current price / cost / delivery %
             → Meta gives campaign / creative spend
             → profit calculated → dashboard updates by itself
```

Simplicity is more important than features. Every number on the dashboard must be explainable with the formulas in §9.

---

## 1. What exists in the repository today (audit summary)

| Area | What exists | Reuse in V1? |
|---|---|---|
| **Framework** | Next.js 16 (App Router), TypeScript, Tailwind, shadcn-style UI kit (`src/components/ui/*`), Recharts, SWR | ✅ **Reuse** as-is |
| **Authentication** | Auth.js (email/password + optional Google login), JWT sessions (`src/lib/auth/auth.ts`) | ✅ **Reuse** |
| **Authorization** | Phase 1 guard: `requireBrandRole` / `authorizeBrandRequest` (`src/lib/auth/guard.ts`, `membership.ts`, `roles.ts`), 390 passing tests | ✅ **Reuse**. Every new API route uses it. |
| **Tenancy** | `brands` + `brand_users` (roles: viewer < manager < owner) | ✅ **Reuse**. Each of your brands (GMSOLO, Shoesthetic, …) is one `brand`. |
| **Database** | Neon Postgres + Drizzle ORM (`src/lib/db`), one old migration | ✅ **Reuse the technology.** Add new tables through new migrations on a **fresh** database (the old `DATABASE_URL` pointed at an unrelated DB). |
| **Shopify** | Manual token connect (`connections/shopify`), REST client (`platforms/shopify/client.ts`) with an HMAC helper, webhook route `api/webhooks/shopify` | ⚠️ **Partly reuse.** Keep the connect flow and HMAC helper. The **webhook route is broken** (reads the body twice → every webhook fails) and must be rewritten. The old `shopify_orders` tables lack UTM, payment type and product fields. |
| **Meta** | Token connect (`connections/meta`), `MetaClient` (`platforms/meta/client.ts`) | ⚠️ **Partly reuse.** Keep the connect flow and client shell. The insights call is broken (wrong date format, campaign-level only, no paging); it needs **ad-level daily spend**. |
| **Google** | `connections/google` is **Google Ads**, not Google Sheets. No Sheets integration exists. No `googleapis` package. | 🆕 **New:** Google Sheets reader. |
| **Profit** | `src/lib/profit/calculations.ts` (paid-only revenue, no shipping, fake ROAS) | ❌ **Do not use.** Replaced by the simple engine in §9. |
| **Attribution** | `src/lib/attribution/tracking.ts` (sums pixel values; not order-based) | ❌ **Do not use.** |
| **Dashboard** | Pages exist but can't load data (brand chosen from a cookie nothing sets; brand page shows hard-coded ₹0) | ⚠️ **Reuse the layout, cards, charts and brand switcher.** Build new V1 pages at `/dashboard/[brandId]/…`. |
| **Live updates / jobs** | No Supabase, no realtime, no queue. `vercel.json` crons point at routes that don't exist; the GitHub Actions sync script can't run. | 🆕 Simple polling + protected cron endpoints (§11, §12) |
| **Credentials** | Tokens stored in plain text; `src/lib/utils/encryption.ts` exists but is unused | 🔧 Start using `encryption.ts` for Shopify, Meta and Google tokens in V1 |
| **Tests** | Vitest set up with mocks and a tenant test matrix | ✅ **Reuse.** Add profit-formula tests. |

**Left untouched and hidden from V1 navigation:** AI, CAPI, pixel, Telegram, billing, Snapchat, TikTok and Google Ads.

---

## 2. System architecture

```
┌──────────────┐  webhook (orders/create, orders/updated, orders/cancelled)
│   SHOPIFY    │──────────────────────────────┐
└──────────────┘                              ▼
                                   /api/webhooks/shopify
                                   verify HMAC → save raw order → parse items + UTMs
                                              │
┌──────────────┐  every 15–30 min             ▼
│   META ADS   │──► /api/cron/meta-sync ──► DATABASE (Neon Postgres)
└──────────────┘    ad-level daily spend      │   RAW:     orders, order_items, order_attribution,
                                              │            meta_campaigns, meta_adsets, meta_ads, meta_daily_spend
┌──────────────┐  every 15 min + "Sync now"   │   CONFIG:  shoes, shoe_economics, product_mappings,
│ GOOGLE SHEET │──► /api/cron/sheet-sync ─────┤            brand_profit_settings
└──────────────┘    (manual economics)        │   LOGS:    webhook_log, sync_runs, economics_sync_runs
                                              ▼
                                   PROFIT ENGINE (SQL views + one TypeScript formula module)
                                   calculated at read time from RAW + CURRENT CONFIG
                                              ▼
                                   /api/brands/[id]/v1/dashboard?from=…&to=…   (Phase 1 guard)
                                              ▼
                                   DASHBOARD (auto-refresh every 30 s + "last updated" time)
```

**Three layers are kept strictly separate:**

| Layer | Examples | Rule |
|---|---|---|
| **RAW** | Shopify order, line items, UTMs, Meta spend | Saved as received. **Never changed** because of an economics change. |
| **CONFIG** | Shoe prices, product cost, shipping, delivery %, GST rates, product mapping | Comes from the Google Sheet (plus a small settings screen). Edited only by you. |
| **CALCULATED** | Net revenue, order profit, creative / campaign / total profit | **Not stored.** Calculated on every dashboard load from RAW + current CONFIG, so changing the sheet updates all dates. |

---

## 3. Database tables (proposed; not created yet)

14 new tables + 3 views. Every table has `brand_id` (tenant boundary) and `created_at` / `updated_at`. Money is `numeric(12,2)`. Percentages are `numeric(5,2)` (95.00 = 95%).

### 3.1 Configuration

| Table | Purpose | Key columns | Unique |
|---|---|---|---|
| `brand_profit_settings` | One row per brand. Central GST settings and the sheet link. | `brand_id` (PK), `product_gst_rate_pct` (default **5.00**, D1), `meta_gst_rate_pct` (default **18.00**), `timezone` (`Asia/Kolkata`), `google_sheet_id`, `economics_tab_name`, `mapping_tab_name`, `strip_prefixes text[]` (e.g. `{"GMSOLO"}`) | `brand_id` |
| `shoes` | **Shoe Master**: one row per shoe name (Nepolian Clog, Zenwalker, Barestep…) | `id`, `brand_id`, `name`, `normalized_name`, `active`, `last_seen_in_sheet_at` | `(brand_id, normalized_name)` |
| `shoe_economics` | **Current** economics per shoe (the latest sheet values) | `shoe_id` (PK), `brand_id`, `prepaid_sp_incl_gst`, `partial_sp_incl_gst`, `product_cost`, `shipping_cost`, `prepaid_delivery_pct`, `partial_delivery_pct`, `gst_rate_pct` (optional per-shoe override), `other_cost_per_order` (optional, default 0), `sheet_row`, `synced_at`, `sync_run_id` | `shoe_id` |
| `product_mappings` | Deterministic "Shopify product → Master shoe" rules | `id`, `brand_id`, `match_type` (`shopify_product_id` \| `title`), `match_value` (normalized), `shoe_id`, `source` (`sheet` \| `auto_exact`) | `(brand_id, match_type, match_value)` |
| `economics_sync_runs` | Log of every sheet sync, with a **snapshot** of what the sheet said (audit only; not used in calculations) | `id`, `brand_id`, `started_at`, `finished_at`, `status`, `rows_read`, `rows_ok`, `rows_rejected`, `errors jsonb`, `snapshot jsonb` | — |

### 3.2 Raw Shopify data

| Table | Purpose | Key columns | Unique |
|---|---|---|---|
| `orders` | One row per Shopify order (raw) | `id`, `brand_id`, `shopify_order_id` (bigint), `shopify_order_gid`, `order_name` (#1234), `ordered_at` (timestamptz), `order_date_ist` (date), `financial_status`, `payment_gateway_names text[]`, `payment_type` (`PREPAID` \| `PARTIAL` \| `COD` \| `UNKNOWN`), `total_price` (customer paid, incl. GST), `subtotal_price`, `total_discounts`, `total_tax`, `currency`, `source_name`, `cancelled_at`, `is_test`, `shopify_updated_at`, `raw jsonb` | `(brand_id, shopify_order_id)` |
| `order_items` | Line items (raw) | `id`, `brand_id`, `order_id`, `shopify_line_item_id`, `shopify_product_id`, `shopify_variant_id`, `product_title`, `variant_title`, `normalized_title`, `sku` (informational only), `quantity`, `unit_price`, `line_discount` | `(order_id, shopify_line_item_id)` |
| `order_attribution` | Raw attribution fields read from the order | `order_id` (PK), `brand_id`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `utm_id`, `fbclid_present`, `landing_site`, `referring_site`, `attribution_source` (`note_attributes` \| `customer_journey` \| `landing_site` \| `none`), `meta_campaign_id`, `meta_adset_id`, `meta_ad_id` (only when a UTM value **is** a Meta numeric ID) | `order_id` |

### 3.3 Raw Meta data

| Table | Purpose | Key columns | Unique |
|---|---|---|---|
| `meta_campaigns` | Campaign names and IDs | `brand_id`, `ad_account_id`, `campaign_id`, `name`, `status` | `(ad_account_id, campaign_id)` |
| `meta_adsets` | Ad set names and IDs | `brand_id`, `adset_id`, `campaign_id`, `name`, `status` | `(ad_account_id, adset_id)` |
| `meta_ads` | **Creative** = Meta ad (D8) | `brand_id`, `ad_id`, `adset_id`, `campaign_id`, `name`, `status`, `creative_id`, `thumbnail_url` | `(ad_account_id, ad_id)` |
| `meta_daily_spend` | Spend per ad per day (the only source of spend) | `brand_id`, `ad_account_id`, `date`, `campaign_id`, `adset_id`, `ad_id`, `spend` (excl. GST, as Meta reports), `impressions`, `clicks`, `meta_purchases`, `meta_purchase_value`, `fetched_at` | `(ad_account_id, ad_id, date)` |

### 3.4 Logs & health

| Table | Purpose | Key columns | Unique |
|---|---|---|---|
| `webhook_log` | Every Shopify webhook received. Prevents duplicates and shows failures. | `id`, `brand_id`, `webhook_id` (Shopify header), `topic`, `shop_domain`, `shopify_order_id`, `received_at`, `status` (`processed` \| `duplicate` \| `failed` \| `ignored`), `error`, `attempts` | `(shop_domain, webhook_id)` |
| `sync_runs` | Every Meta sync, Shopify catch-up sync and sheet sync | `id`, `brand_id`, `source` (`meta` \| `shopify_reconcile` \| `shopify_backfill` \| `sheet`), `status`, `started_at`, `finished_at`, `records`, `error` | — |

### 3.5 Views (the profit engine; nothing stored)

| View | What it returns |
|---|---|
| `v_order_item_profit` | One row per order item: shoe, payment type, SP used, GST, net revenue, delivery %, product cost, shipping, contribution, plus a **status** column (`OK`, `UNMAPPED_PRODUCT`, `MISSING_ECONOMICS`, `UNSUPPORTED_PAYMENT_TYPE`, `CANCELLED`) |
| `v_order_attribution_resolved` | One row per order: `campaign_id` / `campaign_name`, `ad_id` / `ad_name`, `attribution_status` (§8) |
| `v_meta_daily_cost` | Per ad per day: `spend`, `meta_gst = spend × 18%`, `total_meta_cost = spend + meta_gst` |

**Credentials:** reuse the existing `platform_connections` table (Shopify token, Meta token, Google service-account reference), with tokens **encrypted** using the existing `encryption.ts`. No new table is needed.

**Old tables** (`shopify_orders`, `ad_data_snapshots`, …) are not deleted. V1 simply doesn't use them.

---

## 4. Google Sheet design (your control panel)

One Google Sheet per brand (D11), with two tabs.

**Tab 1: `Economics`** (one row per shoe)

| Shoe Name | Prepaid SP (incl GST) | Partial SP (incl GST) | Product Cost | Shipping Cost | Prepaid Delivery % | Partial Delivery % | GST % (optional) | Other Cost / Order (optional) | Active |
|---|---|---|---|---|---|---|---|---|---|
| Nepolian Clog | 1499 | 1399 | 400 | 90 | 95% | 90% | | | Yes |
| Zenwalker | 1299 | 1199 | 350 | 90 | 94% | 88% | | | Yes |

**Tab 2: `Product Mapping`** (only needed when a Shopify title differs from the shoe name)

| Shopify Product Name (or Shopify Product ID) | Master Shoe |
|---|---|
| GMSOLO Nepolian Clog | Nepolian Clog |
| Nepolian Clog - Black | Nepolian Clog |

**Sync rules**
- The sheet is read with a **Google service account** (read-only). You share the sheet with the service account's email.
- The sheet is never made public, so your costs stay private.
- Each row is validated:
  - numbers must be > 0
  - delivery % must be between 1 and 100
  - shoe names must be unique
  - every Master Shoe in the mapping tab must exist in the Economics tab
- **A bad row is rejected and shown on the dashboard.** The shoe keeps its last good values, clearly marked "sheet error — using last synced values from {date}".
- Every sync saves a full snapshot in `economics_sync_runs`, so you can always see what the sheet said on any date.
- The sync runs every 15 minutes, and there is a **"Sync sheet now"** button on the dashboard.

---

## 5. Product / shoe mapping (deterministic, never fuzzy)

**Normalization** (identical in SQL and TypeScript, unit-tested):
1. lowercase
2. trim, and collapse repeated spaces
3. remove a configured brand prefix at the start (e.g. `GMSOLO `), only if it is listed in `strip_prefixes`
4. nothing else (no spelling correction, no similarity matching)

**Matching order** for each order item (the first match wins):

| Step | Rule | Example |
|---|---|---|
| 1 | Mapping tab row with the **Shopify Product ID** | `8123456789` → Nepolian Clog |
| 2 | Mapping tab row whose normalized "Shopify Product Name" = normalized product title | `nepolian clog - black` → Nepolian Clog |
| 3 | Normalized product title = normalized **shoe name** in the Economics tab | `Nepolian Clog` → Nepolian Clog |
| 4 | Otherwise → **UNMAPPED PRODUCT** | shown on the dashboard with a copy-able title so you can add a mapping row |

- The variant (size or colour) is stored but **not** used for mapping, because the economics are per shoe.
- Mapping is applied **at calculation time**. Adding a mapping row in the sheet immediately fixes all past orders of that product; nothing needs re-importing.
- Two different shoes can never be merged automatically. If a title matches two shoes, the item is **UNMAPPED (conflict)**.

---

## 6. Payment type

| Shopify data | V1 payment type |
|---|---|
| `financial_status = paid` | **PREPAID** |
| `financial_status = partially_paid` (advance paid, balance on delivery) | **PARTIAL** |
| `financial_status = pending` with a COD gateway (full COD) | **COD**: not supported in V1. Shown as "Unsupported payment type" and excluded from profit (D4). |
| anything else | **UNKNOWN**: shown as an error |

- If your checkout app (e.g. GoKwik / Shopflo) labels partial orders differently, a small list of gateway names is configurable (D6). No code change is needed.
- **Cancelled orders** and **Shopify test orders** are excluded from profit and shown as counts (D5).

---

## 7. Shopify webhook flow

```
Shopify ──POST──► /api/webhooks/shopify
  1. Read the raw body ONCE; verify X-Shopify-Hmac-Sha256 (constant-time)  → 401 if invalid
  2. Find the brand from X-Shopify-Shop-Domain (platform_connections)       → log "ignored" if unknown
  3. Insert webhook_log (shop_domain, X-Shopify-Webhook-Id)
       └─ already exists → return 200 "duplicate" (Shopify retries never create duplicates)
  4. In one DB transaction:
       • UPSERT orders ON (brand_id, shopify_order_id)
           – only if the incoming updated_at is newer than the stored one (old/out-of-order webhooks are ignored)
       • UPSERT order_items ON (order_id, shopify_line_item_id)
       • UPSERT order_attribution (parsed UTMs, §8)
  5. Mark webhook_log processed → return 200
  On error: mark webhook_log failed (error shown on dashboard) → return 500 so Shopify retries
```

- **Topics:** `orders/create`, `orders/updated`, `orders/cancelled`, `app/uninstalled`.
- **Order updates** (payment captured, cancelled, edited) overwrite the raw order with Shopify's newer version. Profit changes automatically, because profit is calculated at read time.
- **Safety net: catch-up sync every 30 minutes.** It fetches "orders updated since the last run" from Shopify and runs them through the same upsert, so missed webhooks are still captured.
- **First connection:** a one-time **backfill** of the last 60 days of orders.

---

## 8. Attribution flow (real data only, never guessed)

**Where UTMs are read from**, in this order (D7):
1. order **note attributes** (many Indian checkout apps store `utm_*` there)
2. Shopify **customer journey**: the last visit's UTM parameters
3. the **landing site URL** query string

**Recommended Meta URL parameters** (set once in Meta Ads Manager at ad level; D9):
```
utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}
```
IDs never change when you rename a campaign or ad, so matching is exact.

**Resolution rules**

| Result | Condition | Campaign | Creative |
|---|---|---|---|
| **Attributed (campaign + creative)** | `utm_content` equals a known Meta **ad ID** of this brand | from the ad | the ad |
| **Campaign only** | `utm_campaign` equals a known Meta **campaign ID**, with no valid ad ID | that campaign | *Unattributed creative* |
| **Matched by name** (optional fallback, D9) | `utm_campaign` / `utm_content` **exactly** equals a campaign or ad name (after normalization) and the name is unique | as matched | as matched; labelled "by name" |
| **Meta click, IDs missing** | `utm_source` is facebook / instagram / meta, or an `fbclid` is present, but no IDs | *Unattributed* | *Unattributed* |
| **Unattributed** | no UTM data at all, or a non-Meta source | *Unattributed* | *Unattributed* |

- Matching is done at **calculation time**. An order that arrives before its Meta ad has synced becomes attributed automatically after the next Meta sync.
- No AI and no guessing. An ID that doesn't exist in this brand's Meta data is never matched.

---

## 9. Profit calculation (formulas)

All values are **per unit**, multiplied by quantity. One central module (`src/lib/profit-v1/formula.ts`) holds these formulas. The SQL view uses exactly the same math, and unit tests check the two against each other.

### 9.1 Per order item

```
SP            = Prepaid SP (incl GST)  if payment type = PREPAID
                Partial SP (incl GST)  if payment type = PARTIAL
GST %         = shoe GST % from sheet, else brand default (product_gst_rate_pct)
D%            = Prepaid Delivery %     if PREPAID
                Partial Delivery %     if PARTIAL

Net SP (ex-GST)          = SP ÷ (1 + GST%)
Expected Net Revenue     = Net SP × D%                      ← only delivered orders earn revenue
Expected Product Cost    = Product Cost × D%                ← RTO pairs come back to stock (D2)
Shipping Cost            = Shipping Cost                    ← paid on every dispatched order (D3)
Other Cost               = Other Cost / Order (optional, default 0)

ORDER ITEM PROFIT = (Expected Net Revenue − Expected Product Cost − Shipping Cost − Other Cost) × Quantity
```

### 9.2 Worked example (Nepolian Clog, GST 5%)

| | Prepaid | Partial |
|---|---|---|
| SP (incl GST) | ₹1,499.00 | ₹1,399.00 |
| Net SP = SP ÷ 1.05 | ₹1,427.62 | ₹1,332.38 |
| Delivery % | 95% | 90% |
| Expected Net Revenue = Net SP × D% | ₹1,356.24 | ₹1,199.14 |
| − Expected Product Cost = 400 × D% | − ₹380.00 | − ₹360.00 |
| − Shipping | − ₹90.00 | − ₹90.00 |
| **Order profit (before ads)** | **₹886.24** | **₹749.14** |

If you change Prepaid Delivery % from 95% to 92%, the prepaid order becomes 1,427.62 × 0.92 − 400 × 0.92 − 90 = **₹855.41**. That change applies to every date on the dashboard.

### 9.3 Meta cost

```
Meta Spend         = spend reported by Meta (excl. GST)
Meta GST           = Meta Spend × 18%        (meta_gst_rate_pct, configurable)
Total Meta Cost    = Meta Spend + Meta GST   = Meta Spend × 1.18
```
All three values are shown separately on the dashboard.

### 9.4 Creative, campaign and total profit

```
Creative Profit   = Σ Order Profit of orders attributed to that creative (ad)
                  − Total Meta Cost of that ad

Campaign Profit   = Σ Order Profit of orders attributed to that campaign (incl. "campaign-only" orders)
                  − Total Meta Cost of that campaign

TOTAL PROFIT      = Σ Order Profit of ALL valid orders (attributed + unattributed)
                  − Total Meta Cost of ALL campaigns
```

- **Nothing is allocated.** Unattributed orders appear as their own "Unattributed" row in the campaign and creative tables. Their profit counts in **Total Profit**, but is never shared out to campaigns. Campaigns with spend but no matched orders show negative profit, which is the honest result.
- **Worked example:** "Clog Broad" had 20 matched prepaid Nepolian orders and ₹10,000 Meta spend.
  - Order profit = 20 × 886.24 = ₹17,724.80.
  - Meta cost = ₹10,000 × 1.18 = ₹11,800.
  - **Campaign profit = ₹5,924.80.**

### 9.5 Dashboard metrics

| Metric | Formula |
|---|---|
| Orders | count of valid orders (not cancelled, not test) in the date range |
| Order Value (Shopify) | Σ `total_price` as customers paid (incl. GST). **Raw figure, for reference only.** |
| **Net Revenue** | Σ Expected Net Revenue (ex-GST, after delivery %). **Used for profit and margin.** |
| Meta Spend / Meta GST / Total Meta Cost | from §9.3 |
| **Profit** | TOTAL PROFIT (§9.4) |
| Profit Margin | Profit ÷ Net Revenue |
| ROAS | Order Value of matched orders ÷ Meta Spend (the conventional ROAS you already know) |
| Cost per Order (CPP) | Total Meta Cost ÷ matched orders |
| Attribution match rate | matched orders ÷ all valid orders |

**Price check (warning only):** if Shopify's actual line price differs from the sheet SP by more than 5%, the item shows a "price mismatch" warning. The calculation still uses the sheet.

**Date ranges:**
- Orders are counted by order date in **IST**; Meta spend by the ad account's date (IST required; D12).
- Periods: Today, Yesterday, 7 days, 15 days, 30 days (each including today; D10), or a custom range.
- All metrics recalculate from the selected dates.

---

## 10. Meta sync flow

```
Every 15–30 min (and a "Sync Meta now" button):
  for each connected ad account of the brand:
    1. Fetch campaigns, ad sets, ads (names, status, creative thumbnail) → upsert meta_campaigns / meta_adsets / meta_ads
    2. Fetch insights at level=ad, one row per ad per day, for TODAY and YESTERDAY (paged)
         → UPSERT meta_daily_spend ON (ad_account_id, ad_id, date)   (newer numbers replace older ones)
  Once a day: re-fetch the last 7 days (Meta sometimes revises spend)
  Log each run in sync_runs; on error the dashboard shows "Meta sync failed at {time}: {reason}"
```

---

## 11. Google Sheet sync flow

```
Every 15 min (and a "Sync sheet now" button):
  1. Read the Economics and Product Mapping tabs (service account, read-only)
  2. Validate every row (§4); collect row errors
  3. In one transaction: upsert shoes, shoe_economics (valid rows only), product_mappings
  4. Save the snapshot and errors to economics_sync_runs
  5. The dashboard's next refresh uses the new values automatically (profit is calculated at read time)
```

---

## 12. Live dashboard flow

**Shopify webhook → API → Database → (profit is calculated at read time) → Dashboard.**

- **No Supabase or realtime service exists in this project, and none is needed for V1.**
  - The dashboard uses the existing **SWR** library to re-fetch every **30 seconds**, with a "last updated 12 s ago" indicator and a manual refresh button.
  - A new order therefore shows up within about 30 seconds, with no extra infrastructure.
  - A push-based upgrade (Server-Sent Events) can be added later if 30 s is not fast enough.
- **Scheduled syncs** (Meta, sheet, Shopify catch-up) run as `/api/cron/*` endpoints protected by `CRON_SECRET`. They are triggered by GitHub Actions on a schedule (the repo already has workflows), or by Vercel Cron if your plan allows sub-daily schedules (D13).
- **Speed:** at your volume (roughly 1,000 orders/day across brands), calculating 30 days on the fly is a small query (~30k rows) with indexes on `(brand_id, order_date_ist)`. If it ever gets slow, add caching then, not now.

**Dashboard layout** (`/dashboard/[brandId]`)
1. **Period selector:** Today · Yesterday · 7D · 15D · 30D · Custom
2. **Top cards:**
   - Orders (Prepaid / Partial split), Order Value, Net Revenue
   - Meta Spend, Meta GST, Total Meta Cost
   - **Profit**, Profit Margin, ROAS, CPP, Match rate
3. **Profit periods strip:** Today / 7D / 15D / 30D profit side by side
4. **Campaign Performance:** Campaign · Orders · Order Value · Net Revenue · Meta Spend · Total Meta Cost · Profit · ROAS (+ an "Unattributed" row)
5. **Creative Performance:** Creative (thumbnail + name) · Campaign · Orders · Net Revenue · Meta Cost · Profit (+ an "Unattributed" row)
6. **Shoe Performance:** Shoe · Units (Prepaid / Partial) · Net Revenue · Profit before ads
7. **Data Health panel** (§13)

---

## 13. Error handling (nothing is silently wrong)

| Problem | Detection | Dashboard shows | Effect on numbers |
|---|---|---|---|
| Unmapped product | no mapping rule matched | "N items unmapped" + product titles (copy button) | **Excluded** from profit; shown as a count and order value |
| Missing economics | shoe mapped, but no valid sheet row | "Shoe X has no economics" | Excluded; listed |
| Sheet row invalid | validation failed | row number + reason | Keeps last good values (labelled) or excluded if none |
| Unsupported / unknown payment type | COD or unrecognized status | count + order numbers | Excluded; listed |
| Missing campaign attribution | no usable UTM | "Unattributed: N orders (X%)" | Counted in Total Profit; its own row in the tables |
| Missing creative attribution | campaign ID but no ad ID | "Campaign-only: N orders" | Counted under the campaign; creative = Unattributed |
| Missing Meta spend | no successful Meta sync for a selected date, or orders reference an unknown ad | "Meta data missing for {dates}" | Profit is marked **incomplete** (banner) |
| Price mismatch | Shopify price ≠ sheet SP by > 5% | warning per shoe | Warning only |
| Failed Shopify webhook | `webhook_log.status = failed` | count + last error + "Retry" | Caught by the 30-min catch-up sync |
| Failed Meta / Sheet / Shopify sync | `sync_runs.status = failed` | last success time + error | Stale-data banner |

A small **"Data Health: OK / N issues"** badge sits at the top of the dashboard at all times.

---

## 14. Implementation phases (after you approve)

| Phase | Deliverable | You can check |
|---|---|---|
| **1. Schema** | Drizzle schema for the 14 tables + 3 views, a generated SQL migration file (**shown to you before it is applied**), a fresh Neon DB/branch | the SQL file |
| **2. Google Sheet sync** | service-account reader, validation, mapping, "Sync now", health messages | change the sheet → see economics update |
| **3. Shopify** | rewritten webhook + 60-day backfill + 30-min catch-up; payment type; UTM parsing | place a test order → it appears |
| **4. Meta** | ad-level daily spend sync | spend per campaign/ad matches Ads Manager |
| **5. Profit engine** | `formula.ts` + SQL views + unit tests using the Nepolian Clog example | the numbers in §9.2 match exactly |
| **6. Dashboard** | the pages in §12 + Data Health panel + 30 s auto-refresh | end-to-end |

Each phase is small, tested and shown to you before the next one starts.

---

## 15. Decisions needed from you

| # | Question | My default (if you agree) |
|---|---|---|
| **D1** | Product GST rate for shoes | **5%** default for all shoes, with an optional per-shoe GST % column. Please confirm with your CA; footwear GST depends on price slab. |
| **D2** | Should product cost be multiplied by delivery %? (RTO pairs return to stock) | **Yes**: Product Cost × D% |
| **D3** | Shipping: charged on every order, or also add return (RTO) freight? | **Every order, once.** Enter a blended "all-in" shipping cost in the sheet. Option: add RTO freight = Shipping × (1 − D%). |
| **D4** | Full COD orders (no advance) | **Excluded and flagged** in V1 (you said V1 = Prepaid + Partial). Option: add a COD SP + COD Delivery % column. |
| **D5** | Cancelled / refunded / test orders | **Excluded**, shown as counts |
| **D6** | Your checkout / payment apps (to recognize PARTIAL correctly) | Please list them (e.g. GoKwik, Shopflo, Razorpay) |
| **D7** | UTM source priority | note attributes → customer journey (last visit) → landing site |
| **D8** | "Creative" = Meta **ad** (not the underlying creative asset) | **Yes** |
| **D9** | UTM values: Meta **IDs** (recommended) or names? Allow exact-name fallback? | **IDs**, with exact-name fallback enabled and labelled |
| **D10** | "7 days" includes today? | **Yes** (today + previous 6 days) |
| **D11** | One Google Sheet per brand, or one sheet with a Brand column? | **One sheet per brand** |
| **D12** | Meta ad account timezone | Must be **IST** (Asia/Kolkata) so daily spend lines up with orders |
| **D13** | Scheduler for syncs | **GitHub Actions** every 15 min (free, already in the repo), or Vercel Cron if you're on a Pro plan |
| **D14** | Multi-pair orders: shipping per pair or per order? | **Per pair** (matches a per-shoe sheet); switchable to per order |
| **D15** | Which brands and stores go live first? | GMSOLO first, then the others |

---

*No code, schema, migration or database changes were made for this document.*

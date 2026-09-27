CREATE TABLE "ad_creatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"platform" text DEFAULT 'meta' NOT NULL,
	"ad_account_id" text NOT NULL,
	"ad_id" text NOT NULL,
	"ad_name" text NOT NULL,
	"adset_id" text,
	"adset_name" text,
	"campaign_id" text,
	"campaign_name" text,
	"creative_id" text,
	"creative_name" text,
	"thumbnail_url" text,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_creatives_brand_platform_ad_unique" UNIQUE("brand_id","platform","ad_id")
);
--> statement-breakpoint
CREATE TABLE "ad_spend_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"platform" text DEFAULT 'meta' NOT NULL,
	"ad_account_id" text NOT NULL,
	"date" date NOT NULL,
	"campaign_id" text NOT NULL,
	"campaign_name" text,
	"adset_id" text,
	"adset_name" text,
	"ad_id" text NOT NULL,
	"ad_name" text,
	"spend" numeric(12, 2) DEFAULT '0' NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"purchases" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_spend_daily_brand_platform_ad_date_unique" UNIQUE("brand_id","platform","ad_id","date")
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"shopify_line_item_id" text NOT NULL,
	"shopify_product_id" text,
	"shopify_variant_id" text,
	"product_title" text NOT NULL,
	"variant_title" text,
	"line_name" text,
	"sku" text,
	"quantity" integer NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_order_line_unique" UNIQUE("order_id","shopify_line_item_id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"shop_domain" text NOT NULL,
	"shopify_order_id" text NOT NULL,
	"order_number" text NOT NULL,
	"order_name" text,
	"order_date" date NOT NULL,
	"shopify_created_at" timestamp with time zone NOT NULL,
	"shopify_updated_at" timestamp with time zone NOT NULL,
	"currency" text,
	"total_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"subtotal_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_discounts" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_tax" numeric(12, 2) DEFAULT '0' NOT NULL,
	"payment_type" text NOT NULL,
	"payment_gateways" text[] DEFAULT '{}' NOT NULL,
	"financial_status" text,
	"fulfillment_status" text,
	"order_status" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"tags" text,
	"source_name" text,
	"is_test" boolean DEFAULT false NOT NULL,
	"landing_site" text,
	"referring_site" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"utm_id" text,
	"meta_campaign_id" text,
	"meta_adset_id" text,
	"meta_ad_id" text,
	"attribution_raw" jsonb,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_brand_shopify_order_unique" UNIQUE("brand_id","shopify_order_id")
);
--> statement-breakpoint
CREATE TABLE "profit_settings" (
	"brand_id" uuid PRIMARY KEY NOT NULL,
	"google_sheet_id" text,
	"config_range" text DEFAULT 'Config!A1:Z1000' NOT NULL,
	"mapping_range" text,
	"default_product_gst_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shoe_config_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"status" text NOT NULL,
	"triggered_by" text NOT NULL,
	"rows_read" integer DEFAULT 0 NOT NULL,
	"rows_applied" integer DEFAULT 0 NOT NULL,
	"rows_rejected" integer DEFAULT 0 NOT NULL,
	"mappings_applied" integer DEFAULT 0 NOT NULL,
	"errors" jsonb,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shoe_name_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"shopify_name" text NOT NULL,
	"normalized_shopify_name" text NOT NULL,
	"shoe_name" text NOT NULL,
	"normalized_shoe_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shoe_name_mappings_brand_name_unique" UNIQUE("brand_id","normalized_shopify_name")
);
--> statement-breakpoint
CREATE TABLE "shoe_profit_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"shoe_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"prepaid_selling_price" numeric(12, 2) NOT NULL,
	"cod_or_partial_selling_price" numeric(12, 2) NOT NULL,
	"product_cost" numeric(12, 2) NOT NULL,
	"prepaid_shipping_cost" numeric(12, 2) NOT NULL,
	"cod_shipping_cost" numeric(12, 2) NOT NULL,
	"prepaid_delivery_percent" numeric(5, 2) NOT NULL,
	"cod_or_partial_delivery_percent" numeric(5, 2) NOT NULL,
	"gst_percent" numeric(5, 2),
	"sheet_row" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shoe_profit_config_brand_name_unique" UNIQUE("brand_id","normalized_name")
);
--> statement-breakpoint
CREATE TABLE "webhook_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid,
	"provider" text DEFAULT 'shopify' NOT NULL,
	"shop_domain" text NOT NULL,
	"webhook_id" text NOT NULL,
	"topic" text NOT NULL,
	"resource_id" text,
	"status" text NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_receipts_shop_webhook_unique" UNIQUE("shop_domain","webhook_id")
);
--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_spend_daily" ADD CONSTRAINT "ad_spend_daily_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profit_settings" ADD CONSTRAINT "profit_settings_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoe_config_sync_runs" ADD CONSTRAINT "shoe_config_sync_runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoe_name_mappings" ADD CONSTRAINT "shoe_name_mappings_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoe_profit_config" ADD CONSTRAINT "shoe_profit_config_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_receipts" ADD CONSTRAINT "webhook_receipts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_creatives_brand_campaign_idx" ON "ad_creatives" USING btree ("brand_id","campaign_id");--> statement-breakpoint
CREATE INDEX "ad_spend_daily_brand_date_idx" ON "ad_spend_daily" USING btree ("brand_id","date");--> statement-breakpoint
CREATE INDEX "order_items_brand_order_idx" ON "order_items" USING btree ("brand_id","order_id");--> statement-breakpoint
CREATE INDEX "orders_brand_date_idx" ON "orders" USING btree ("brand_id","order_date");--> statement-breakpoint
CREATE INDEX "shoe_config_sync_runs_brand_idx" ON "shoe_config_sync_runs" USING btree ("brand_id","started_at");--> statement-breakpoint
CREATE INDEX "shoe_name_mappings_brand_idx" ON "shoe_name_mappings" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "shoe_profit_config_brand_idx" ON "shoe_profit_config" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "webhook_receipts_brand_idx" ON "webhook_receipts" USING btree ("brand_id","received_at");
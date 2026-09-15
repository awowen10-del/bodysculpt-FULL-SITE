CREATE TABLE "ad_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meta_ad_account_id" text NOT NULL,
	"name" text,
	"currency" text NOT NULL,
	"timezone_name" text NOT NULL,
	"connection_status" text DEFAULT 'unknown' NOT NULL,
	"last_successful_sync_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"missing_since" timestamp with time zone,
	"consecutive_full_scope_misses" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_accounts_meta_ad_account_id_unique" UNIQUE("meta_ad_account_id")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"meta_campaign_id" text NOT NULL,
	"name" text,
	"objective" text,
	"status" text,
	"effective_status" text,
	"buying_type" text,
	"created_time" timestamp with time zone,
	"start_time" timestamp with time zone,
	"stop_time" timestamp with time zone,
	"updated_time" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"missing_since" timestamp with time zone,
	"consecutive_full_scope_misses" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_meta_campaign_id_unique" UNIQUE("meta_campaign_id")
);
--> statement-breakpoint
CREATE TABLE "ad_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"meta_ad_set_id" text NOT NULL,
	"name" text,
	"status" text,
	"effective_status" text,
	"daily_budget_minor" bigint,
	"lifetime_budget_minor" bigint,
	"budget_currency" text,
	"optimization_goal" text,
	"billing_event" text,
	"bid_strategy" text,
	"attribution_setting" text,
	"targeting_summary" jsonb,
	"start_time" timestamp with time zone,
	"end_time" timestamp with time zone,
	"updated_time" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"missing_since" timestamp with time zone,
	"consecutive_full_scope_misses" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_sets_meta_ad_set_id_unique" UNIQUE("meta_ad_set_id")
);
--> statement-breakpoint
CREATE TABLE "ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_set_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"meta_ad_id" text NOT NULL,
	"name" text,
	"status" text,
	"effective_status" text,
	"creative_id" uuid,
	"created_time" timestamp with time zone,
	"updated_time" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"missing_since" timestamp with time zone,
	"consecutive_full_scope_misses" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ads_meta_ad_id_unique" UNIQUE("meta_ad_id")
);
--> statement-breakpoint
CREATE TABLE "creatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"meta_creative_id" text NOT NULL,
	"object_type" text,
	"primary_text" text,
	"headline" text,
	"description" text,
	"cta_type" text,
	"destination_url" text,
	"image_url" text,
	"thumbnail_url" text,
	"video_id" text,
	"asset_metadata" jsonb,
	"original_asset_ref" text,
	"last_synced_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"missing_since" timestamp with time zone,
	"consecutive_full_scope_misses" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creatives_meta_creative_id_unique" UNIQUE("meta_creative_id")
);
--> statement-breakpoint
CREATE TABLE "daily_ad_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_id" uuid NOT NULL,
	"ad_set_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"currency" text NOT NULL,
	"spend" numeric(18, 6),
	"impressions" bigint,
	"reach" bigint,
	"clicks" bigint,
	"inline_link_clicks" bigint,
	"outbound_clicks" bigint,
	"video_play_actions" bigint,
	"video_p25_watched_actions" bigint,
	"video_p50_watched_actions" bigint,
	"video_p75_watched_actions" bigint,
	"video_p95_watched_actions" bigint,
	"video_p100_watched_actions" bigint,
	"leads" bigint,
	"landing_page_views" bigint,
	"reported_frequency" numeric(14, 6),
	"reported_cpm" numeric(18, 6),
	"reported_ctr" numeric(14, 6),
	"reported_cpc" numeric(18, 6),
	"reported_inline_link_click_ctr" numeric(14, 6),
	"reported_cost_per_inline_link_click" numeric(18, 6),
	"reported_outbound_clicks_ctr" numeric(14, 6),
	"reported_cost_per_outbound_click" numeric(18, 6),
	"reported_cost_per_thruplay" numeric(18, 6),
	"reported_video_avg_time_watched_actions" numeric(14, 6),
	"leads_action_type" text,
	"landing_page_views_action_type" text,
	"actions" jsonb,
	"action_values" jsonb,
	"cost_per_action_type" jsonb,
	"attribution_setting" text,
	"api_version" text NOT NULL,
	"raw_snapshot" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_ad_insights_ad_id_date_unq" UNIQUE("ad_id","date")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid,
	"level" text NOT NULL,
	"scope" text DEFAULT 'incremental' NOT NULL,
	"date_range_start" date,
	"date_range_end" date,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"records_requested" integer,
	"records_written" integer,
	"status" text DEFAULT 'running' NOT NULL,
	"errors" jsonb,
	"rate_limit_info" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_campaign_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"campaign_type" text,
	"offer" text,
	"audience_purpose" text,
	"location" text,
	"notes" text,
	"known_anomalies" text,
	"include_in_benchmarks" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_campaign_context_campaign_id_unique" UNIQUE("campaign_id")
);
--> statement-breakpoint
CREATE TABLE "metric_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"meaning" text,
	"formula" text,
	"meta_source" text,
	"valid_level" text,
	"origin" text NOT NULL,
	"limitations" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_definitions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_ad_set_id_ad_sets_id_fk" FOREIGN KEY ("ad_set_id") REFERENCES "public"."ad_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_creative_id_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."creatives"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_ad_insights" ADD CONSTRAINT "daily_ad_insights_ad_id_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."ads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_ad_insights" ADD CONSTRAINT "daily_ad_insights_ad_set_id_ad_sets_id_fk" FOREIGN KEY ("ad_set_id") REFERENCES "public"."ad_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_ad_insights" ADD CONSTRAINT "daily_ad_insights_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_ad_insights" ADD CONSTRAINT "daily_ad_insights_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_campaign_context" ADD CONSTRAINT "manual_campaign_context_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_campaigns_ad_account_id" ON "campaigns" USING btree ("ad_account_id");--> statement-breakpoint
CREATE INDEX "idx_ad_sets_campaign_id" ON "ad_sets" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_ad_sets_ad_account_id" ON "ad_sets" USING btree ("ad_account_id");--> statement-breakpoint
CREATE INDEX "idx_ads_ad_set_id" ON "ads" USING btree ("ad_set_id");--> statement-breakpoint
CREATE INDEX "idx_ads_campaign_id" ON "ads" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_ads_creative_id" ON "ads" USING btree ("creative_id");--> statement-breakpoint
CREATE INDEX "idx_creatives_ad_account_id" ON "creatives" USING btree ("ad_account_id");--> statement-breakpoint
CREATE INDEX "idx_dai_date" ON "daily_ad_insights" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_dai_campaign_date" ON "daily_ad_insights" USING btree ("campaign_id","date");--> statement-breakpoint
CREATE INDEX "idx_dai_ad_set_date" ON "daily_ad_insights" USING btree ("ad_set_id","date");--> statement-breakpoint
CREATE INDEX "idx_dai_ad_account_date" ON "daily_ad_insights" USING btree ("ad_account_id","date");--> statement-breakpoint
CREATE INDEX "idx_sync_runs_started_at" ON "sync_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "idx_sync_runs_status" ON "sync_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_sync_runs_scope" ON "sync_runs" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "idx_sync_runs_ad_account_id" ON "sync_runs" USING btree ("ad_account_id");
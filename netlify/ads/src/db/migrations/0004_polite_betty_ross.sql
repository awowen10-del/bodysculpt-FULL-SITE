CREATE TABLE "daily_ad_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_account_id" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"window_start" date,
	"window_end" date,
	"input_snapshot" jsonb NOT NULL,
	"briefing" jsonb NOT NULL,
	"source" text NOT NULL,
	"model" text,
	"settings_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_ad_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "daily_ad_checks" ADD CONSTRAINT "daily_ad_checks_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_daily_ad_checks_generated_at" ON "daily_ad_checks" USING btree ("generated_at");--> statement-breakpoint
CREATE INDEX "idx_daily_ad_checks_ad_account_id" ON "daily_ad_checks" USING btree ("ad_account_id");
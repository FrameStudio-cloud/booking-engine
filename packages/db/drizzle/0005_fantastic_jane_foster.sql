ALTER TABLE "services" ADD COLUMN "source" varchar(16) DEFAULT 'preset' NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "catalog_synced_at" timestamp with time zone DEFAULT now() NOT NULL;
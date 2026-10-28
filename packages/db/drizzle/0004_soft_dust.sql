ALTER TABLE "bookings" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "status_changed_by" varchar(16);--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "status_reason" text;
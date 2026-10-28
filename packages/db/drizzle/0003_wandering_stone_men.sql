-- Booking snapshots (PLAN-V2 8.4).
--
-- Existing rows are backfilled from the service as it stands today. That is the
-- best available answer, not a recovered one: before this migration the price
-- was never stored on the booking. Everything written from here on carries its own.
ALTER TABLE "bookings" ADD COLUMN "service_name_at_booking" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "duration_minutes_at_booking" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "price_minor_at_booking" integer;--> statement-breakpoint
UPDATE "bookings" b
SET "service_name_at_booking" = s."name",
    "duration_minutes_at_booking" = s."duration_minutes",
    "price_minor_at_booking" = s."price_minor"
FROM "services" s
WHERE s."id" = b."service_id";--> statement-breakpoint
UPDATE "bookings"
SET "service_name_at_booking" = '',
    "duration_minutes_at_booking" = 0,
    "price_minor_at_booking" = 0
WHERE "service_name_at_booking" IS NULL;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "service_name_at_booking" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "duration_minutes_at_booking" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "price_minor_at_booking" SET NOT NULL;

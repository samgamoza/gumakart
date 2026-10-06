-- Phase 24: parcel courier waybills (J&T, LBC, Flash, Ninja Van…) entered by the seller or booked
-- through an aggregator later. Additive only.
ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "courier_name" varchar(40);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN IF NOT EXISTS "tracking_number" varchar(64);

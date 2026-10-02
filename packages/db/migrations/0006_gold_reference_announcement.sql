CREATE TABLE "gold_reference_announcement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announced_at" timestamp with time zone NOT NULL,
	"round" integer,
	"source" text NOT NULL,
	"bar_buy" numeric(14, 2) NOT NULL,
	"bar_sell" numeric(14, 2) NOT NULL,
	"ornament_buy" numeric(14, 2) NOT NULL,
	"ornament_sell" numeric(14, 2) NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gold_reference_announcement_announced_at_round" UNIQUE NULLS NOT DISTINCT("announced_at","round"),
	CONSTRAINT "gold_reference_announcement_round_positive" CHECK ("gold_reference_announcement"."round" IS NULL OR "gold_reference_announcement"."round" > 0),
	CONSTRAINT "gold_reference_announcement_prices_positive" CHECK ("gold_reference_announcement"."bar_buy" > 0 AND "gold_reference_announcement"."bar_sell" > 0 AND "gold_reference_announcement"."ornament_buy" > 0 AND "gold_reference_announcement"."ornament_sell" > 0)
);

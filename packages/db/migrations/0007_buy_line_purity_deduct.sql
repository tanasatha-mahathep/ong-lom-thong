-- db-verify: allow contract buy_line_purity_range only bounds purity_percent, which no release has written (every existing row is NULL, which passes)
ALTER TABLE "buy_line" ADD COLUMN "deduct_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "buy_line" ADD COLUMN "base_price" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "buy_line" ADD COLUMN "assessed_price_per_g" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "gold_price" ADD COLUMN "silver_per_g" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "gold_price" ADD COLUMN "platinum_per_g" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "buy_line" ADD CONSTRAINT "buy_line_purity_range" CHECK ("buy_line"."purity_percent" IS NULL OR ("buy_line"."purity_percent" > 0 AND "buy_line"."purity_percent" <= 100));--> statement-breakpoint
ALTER TABLE "buy_line" ADD CONSTRAINT "buy_line_deduct_range" CHECK ("buy_line"."deduct_percent" IS NULL OR ("buy_line"."deduct_percent" >= 0 AND "buy_line"."deduct_percent" <= 100));--> statement-breakpoint
ALTER TABLE "gold_price" ADD CONSTRAINT "gold_price_metal_per_g_positive" CHECK (("gold_price"."silver_per_g" IS NULL OR "gold_price"."silver_per_g" > 0) AND ("gold_price"."platinum_per_g" IS NULL OR "gold_price"."platinum_per_g" > 0));
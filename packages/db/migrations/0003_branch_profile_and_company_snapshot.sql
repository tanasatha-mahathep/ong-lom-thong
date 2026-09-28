ALTER TABLE "branch" ADD COLUMN "short_name" text;--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "tel" text;--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "doc_prefix" text;--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "buy_receipt" ADD COLUMN "company_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "branch" ADD CONSTRAINT "branch_tax_branch_code_format" CHECK ("branch"."tax_branch_code" IS NULL OR "branch"."tax_branch_code" ~ '^[0-9]{5}$');--> statement-breakpoint
ALTER TABLE "branch" ADD CONSTRAINT "branch_doc_prefix_format" CHECK ("branch"."doc_prefix" IS NULL OR "branch"."doc_prefix" ~ '^[A-Z]{1,4}$');
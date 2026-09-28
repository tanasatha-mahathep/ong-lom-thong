ALTER TABLE "buy_receipt" ADD COLUMN "void_pdf_key" text;--> statement-breakpoint
ALTER TABLE "buy_receipt" ADD COLUMN "void_pdf_sha256" text;--> statement-breakpoint
ALTER TABLE "buy_receipt" ADD COLUMN "void_pdf_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "buy_receipt" ADD COLUMN "void_pdf_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "buy_receipt" ADD COLUMN "pdf_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "buy_receipt" ADD COLUMN "pdf_lease_token" uuid;--> statement-breakpoint
ALTER TABLE "buy_receipt" ADD COLUMN "pdf_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "buy_receipt" ADD COLUMN "pdf_retry_after" timestamp with time zone;
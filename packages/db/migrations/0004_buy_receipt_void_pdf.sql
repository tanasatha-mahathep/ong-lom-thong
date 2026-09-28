ALTER TABLE "buy_receipt" ADD COLUMN "void_pdf_key" text;--> statement-breakpoint
ALTER TABLE "buy_receipt" ADD COLUMN "void_pdf_sha256" text;--> statement-breakpoint
ALTER TABLE "buy_receipt" ADD COLUMN "void_pdf_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "buy_receipt" ADD COLUMN "void_pdf_generated_at" timestamp with time zone;
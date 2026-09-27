CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"table_name" text NOT NULL,
	"row_id" text NOT NULL,
	"diff" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"tax_branch_code" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "buy_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"metal_id" uuid NOT NULL,
	"weight_g" numeric(12, 3) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"price_per_g" numeric(14, 2) NOT NULL,
	"assessment_amount" numeric(14, 2),
	"purity_percent" numeric(6, 3),
	CONSTRAINT "buy_line_receipt_line_no" UNIQUE("receipt_id","line_no"),
	CONSTRAINT "buy_line_weight_positive" CHECK ("buy_line"."weight_g" > 0),
	CONSTRAINT "buy_line_amount_positive" CHECK ("buy_line"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "buy_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"date" date NOT NULL,
	"time" time NOT NULL,
	"customer_id" uuid NOT NULL,
	"gold_price_snapshot" numeric(14, 2) NOT NULL,
	"detail" text,
	"full_tax" boolean DEFAULT false NOT NULL,
	"total_weight" numeric(12, 3) NOT NULL,
	"total_amount" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"pdf_key" text,
	"pdf_sha256" text,
	"pdf_status" text DEFAULT 'pending' NOT NULL,
	"pdf_generated_at" timestamp with time zone,
	"idcard_pdf_key" text,
	"idcard_sha256" text,
	"idcard_status" text DEFAULT 'none' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_by" text,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"idempotency_key" text NOT NULL,
	CONSTRAINT "buy_receipt_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "buy_receipt_branch_doc_no" UNIQUE("branch_id","doc_no"),
	CONSTRAINT "buy_receipt_total_weight_positive" CHECK ("buy_receipt"."total_weight" > 0),
	CONSTRAINT "buy_receipt_total_amount_positive" CHECK ("buy_receipt"."total_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"national_id" text NOT NULL,
	"name_th" text NOT NULL,
	"name_en" text,
	"birthday_text" text,
	"religion" text,
	"address" text,
	"card_issue_text" text,
	"card_expire_text" text,
	"card_expire_date" date,
	"mobile" text,
	"phone2" text,
	"photo_key" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_national_id_unique" UNIQUE("national_id")
);
--> statement-breakpoint
CREATE TABLE "doc_sequence" (
	"branch_id" uuid NOT NULL,
	"prefix" text NOT NULL,
	"period" text NOT NULL,
	"last_no" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "doc_sequence_branch_id_prefix_period_pk" PRIMARY KEY("branch_id","prefix","period")
);
--> statement-breakpoint
CREATE TABLE "gold_price" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid,
	"date" date NOT NULL,
	"bar_sell" numeric(14, 2) NOT NULL,
	"bar_buy" numeric(14, 2) NOT NULL,
	"jewelry_buy" numeric(14, 2) NOT NULL,
	"set_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gold_price_branch_date" UNIQUE NULLS NOT DISTINCT("branch_id","date")
);
--> statement-breakpoint
CREATE TABLE "gold_price_setting" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"diff" numeric(14, 2) DEFAULT '200' NOT NULL,
	"jewelry_discount" numeric(6, 4) DEFAULT '0.95' NOT NULL,
	"typo_guard_percent" numeric(5, 2) DEFAULT '3' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gold_price_setting_single_row" CHECK ("gold_price_setting"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "metal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_th" text NOT NULL,
	"unit" text DEFAULT 'g' NOT NULL,
	"assessment_enabled" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "metal_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"method" text NOT NULL,
	"bank" text,
	"amount" numeric(14, 2) NOT NULL,
	CONSTRAINT "payment_amount_positive" CHECK ("payment"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"current_branch_id" uuid,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "stock_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"metal_id" uuid NOT NULL,
	"date" date NOT NULL,
	"grams" numeric(12, 3) NOT NULL,
	"source_receipt_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"branch_id" uuid,
	"allowed_branch_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"can_view_all" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buy_line" ADD CONSTRAINT "buy_line_receipt_id_buy_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."buy_receipt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buy_line" ADD CONSTRAINT "buy_line_metal_id_metal_id_fk" FOREIGN KEY ("metal_id") REFERENCES "public"."metal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buy_receipt" ADD CONSTRAINT "buy_receipt_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buy_receipt" ADD CONSTRAINT "buy_receipt_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buy_receipt" ADD CONSTRAINT "buy_receipt_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buy_receipt" ADD CONSTRAINT "buy_receipt_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_sequence" ADD CONSTRAINT "doc_sequence_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_price" ADD CONSTRAINT "gold_price_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_price" ADD CONSTRAINT "gold_price_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_receipt_id_buy_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."buy_receipt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_current_branch_id_branch_id_fk" FOREIGN KEY ("current_branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_metal_id_metal_id_fk" FOREIGN KEY ("metal_id") REFERENCES "public"."metal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_source_receipt_id_buy_receipt_id_fk" FOREIGN KEY ("source_receipt_id") REFERENCES "public"."buy_receipt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_table_row_idx" ON "audit_log" USING btree ("table_name","row_id");--> statement-breakpoint
CREATE INDEX "buy_receipt_branch_date_idx" ON "buy_receipt" USING btree ("branch_id","date");--> statement-breakpoint
CREATE INDEX "buy_receipt_customer_idx" ON "buy_receipt" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_name_idx" ON "customer" USING btree ("name_th");--> statement-breakpoint
CREATE INDEX "customer_mobile_idx" ON "customer" USING btree ("mobile");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stock_movement_branch_metal_date_idx" ON "stock_movement" USING btree ("branch_id","metal_id","date");
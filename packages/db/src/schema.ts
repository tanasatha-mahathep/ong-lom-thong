import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// เงิน numeric(14,2) · น้ำหนัก numeric(12,3) — ห้าม float8 ทุกที่ (กฎ 3.1)
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const grams = (name: string) => numeric(name, { precision: 12, scale: 3 });
const tz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => tz("created_at").notNull().defaultNow();
const updatedAt = () => tz("updated_at").notNull().defaultNow();

export const ROLES = ["staff", "manager", "accounting", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** สาขา — ฟิลด์ตามโมเดล Branch ของ Django ที่ใช้งานจริงมาแล้ว */
export const branch = pgTable(
  "branch",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** รหัสภายใน — อยู่ใน key ของไฟล์ PDF จึงห้ามแก้หลังมีบิล */
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    shortName: text("short_name"),
    /** รหัสสาขา 5 หลักของกรมสรรพากร ("00000" = สำนักงานใหญ่) — พิมพ์บนหัวใบทุกใบ · null = ออก PDF ไม่ได้ */
    taxBranchCode: text("tax_branch_code"),
    /** ที่อยู่/โทรที่พิมพ์บนหัวใบของสาขานี้ · null = ใช้ของบริษัท (COMPANY_*) */
    address: text("address"),
    tel: text("tel"),
    /** อักษรนำเลขเอกสาร เช่น "PT" → PT-RC6910-0001 · null = ไม่ใส่ */
    docPrefix: text("doc_prefix"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    check("branch_tax_branch_code_format", sql`${t.taxBranchCode} IS NULL OR ${t.taxBranchCode} ~ '^[0-9]{5}$'`),
    check("branch_doc_prefix_format", sql`${t.docPrefix} IS NULL OR ${t.docPrefix} ~ '^[A-Z]{1,4}$'`),
  ],
);

// ---------- better-auth core tables (ชื่อ field ต้องตรงกับที่ better-auth คาด) ----------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  // app fields
  role: text("role", { enum: ROLES }).notNull().default("staff"),
  branchId: uuid("branch_id").references(() => branch.id),
  allowedBranchIds: uuid("allowed_branch_ids")
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  canViewAll: boolean("can_view_all").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: tz("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    currentBranchId: uuid("current_branch_id").references(() => branch.id),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tz("access_token_expires_at"),
    refreshTokenExpiresAt: tz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: tz("expires_at").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------- master data ----------

export const metal = pgTable("metal", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  nameTh: text("name_th").notNull(),
  unit: text("unit").notNull().default("g"),
  /** โหมดประเมินราคา — ระบบเดิมปิดทุกโลหะ (status_assessment_price = no) */
  assessmentEnabled: boolean("assessment_enabled").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const customer = pgTable(
  "customer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nationalId: text("national_id").notNull().unique(),
    nameTh: text("name_th").notNull(),
    nameEn: text("name_en"),
    // วันที่จาก Siam ID เก็บเป็นข้อความตามที่พิมพ์มา + ค่าที่ parse ได้แยกต่างหาก
    birthdayText: text("birthday_text"),
    religion: text("religion"),
    address: text("address"),
    cardIssueText: text("card_issue_text"),
    cardExpireText: text("card_expire_text"),
    cardExpireDate: date("card_expire_date"),
    mobile: text("mobile"),
    phone2: text("phone2"),
    /** object key ใน bucket photos/ — ไม่มี public URL */
    photoKey: text("photo_key"),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
    updatedBy: text("updated_by").references(() => user.id),
    updatedAt: updatedAt(),
  },
  (t) => [index("customer_name_idx").on(t.nameTh), index("customer_mobile_idx").on(t.mobile)],
);

export const goldPrice = pgTable(
  "gold_price",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** null = ราคากลางทุกสาขา */
    branchId: uuid("branch_id").references(() => branch.id),
    date: date("date").notNull(),
    barSell: money("bar_sell").notNull(),
    barBuy: money("bar_buy").notNull(),
    jewelryBuy: money("jewelry_buy").notNull(),
    setBy: text("set_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [unique("gold_price_branch_date").on(t.branchId, t.date).nullsNotDistinct()],
);

export const goldPriceSetting = pgTable(
  "gold_price_setting",
  {
    id: integer("id").primaryKey().default(1),
    diff: money("diff").notNull().default("200"),
    jewelryDiscount: numeric("jewelry_discount", { precision: 6, scale: 4 }).notNull().default("0.95"),
    typoGuardPercent: numeric("typo_guard_percent", { precision: 5, scale: 2 }).notNull().default("3"),
    updatedAt: updatedAt(),
  },
  (t) => [check("gold_price_setting_single_row", sql`${t.id} = 1`)],
);

/** ตัวนับเลขที่เอกสารต่อสาขาต่องวด — อัปเดตผ่าน next_doc_no() เท่านั้น */
export const docSequence = pgTable(
  "doc_sequence",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    prefix: text("prefix").notNull(),
    period: text("period").notNull(),
    lastNo: integer("last_no").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.prefix, t.period] })],
);

// ---------- ซื้อเข้าหน้าร้าน ----------

/**
 * ข้อมูลลูกค้า ณ ตอนเปิดบิล (R15) — PDF ทุกฉบับของบิล (รวมฉบับยกเลิกที่สร้างทีหลังหลายวัน) ต้องออกมาเหมือนตอนขาย
 * แม้ลูกค้าถูกแก้ภายหลัง · ชื่อ key ตามคอลัมน์ของ customer · เลขบัตรเต็มอยู่ที่นี่เพื่อ PDF — api ต้องมาสก์ทุกที่ (R13)
 */
/** หัวใบ ณ ตอนบันทึกบิล (R15) — PDF/ใบยกเลิกที่สร้างทีหลังต้องได้หัวเดิม แม้ที่อยู่/ชื่อสาขาเปลี่ยน */
export interface CompanySnapshot {
  name: string;
  address: string | null;
  tel: string | null;
  fax: string | null;
  tax_id: string | null;
  branch_name: string;
  branch_code: string;
  tax_branch_code: string | null;
}

export interface CustomerSnapshot {
  national_id: string;
  name_th: string;
  name_en: string | null;
  birthday_text: string | null;
  religion: string | null;
  address: string | null;
  card_issue_text: string | null;
  card_expire_text: string | null;
  mobile: string | null;
  phone2: string | null;
  /** object key ของรูปบัตรตอนเปิดบิล — สำเนาบัตรต้องใช้รูปนี้ ไม่ใช่รูปล่าสุด */
  photo_key: string | null;
}

/**
 * สถานะไฟล์ PDF เก็บถาวร (text ไม่มี constraint ใน DB — เพิ่มค่าได้ไม่ต้อง migrate)
 * failed = ล้มชั่วคราว (Gotenberg/bucket) retry เองทุก 5 นาที · invalid = ข้อมูลบิลพิมพ์ไม่ได้ ต้องแก้แล้วกด retry เอง
 */
export const PDF_STATUSES = ["pending", "ready", "failed", "invalid"] as const;

export const buyReceipt = pgTable(
  "buy_receipt",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    docNo: text("doc_no").notNull(),
    date: date("date").notNull(),
    time: time("time").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id),
    customerSnapshot: jsonb("customer_snapshot").$type<CustomerSnapshot>().notNull(),
    /** null ได้เฉพาะบิลที่บันทึกก่อนมีคอลัมน์นี้ */
    companySnapshot: jsonb("company_snapshot").$type<CompanySnapshot>(),
    /** ราคาทองแท่งขายออก ณ วันเปิดบิล (ระบบเดิม sold_out) — ติดบิล ไม่ใช้คำนวณ */
    goldPriceSnapshot: money("gold_price_snapshot").notNull(),
    detail: text("detail"),
    fullTax: boolean("full_tax").notNull().default(false),
    totalWeight: grams("total_weight").notNull(),
    totalAmount: money("total_amount").notNull(),
    status: text("status", { enum: ["active", "void"] })
      .notNull()
      .default("active"),
    pdfKey: text("pdf_key"),
    pdfSha256: text("pdf_sha256"),
    pdfStatus: text("pdf_status", { enum: PDF_STATUSES }).notNull().default("pending"),
    pdfGeneratedAt: tz("pdf_generated_at"),
    idcardPdfKey: text("idcard_pdf_key"),
    idcardSha256: text("idcard_sha256"),
    idcardStatus: text("idcard_status", { enum: ["none", ...PDF_STATUSES] })
      .notNull()
      .default("none"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    voidedBy: text("voided_by").references(() => user.id),
    voidedAt: tz("voided_at"),
    voidReason: text("void_reason"),
    // PDF ฉบับยกเลิก (…_void.pdf) เป็นไฟล์ใหม่ — ฉบับเดิมและ sha256 ของมันใน pdf_* ไม่ถูกแตะ (R15)
    voidPdfKey: text("void_pdf_key"),
    voidPdfSha256: text("void_pdf_sha256"),
    voidPdfStatus: text("void_pdf_status", { enum: ["none", ...PDF_STATUSES] })
      .notNull()
      .default("none"),
    voidPdfGeneratedAt: tz("void_pdf_generated_at"),
    // งานสร้าง PDF ของบิลนี้: lease = ผู้เขียนคนเดียว (จองสั้น ๆ ไม่ถือ transaction ระหว่าง Gotenberg/bucket)
    // หมดอายุเองถ้าผู้ถือค้าง/ตาย · retry_after = backoff ของงานที่ล้มชั่วคราว (2 นาที ×2 … สูงสุด 1 ชม.)
    pdfLeaseUntil: tz("pdf_lease_until"),
    pdfLeaseToken: uuid("pdf_lease_token"),
    pdfAttempts: integer("pdf_attempts").notNull().default(0),
    pdfRetryAfter: tz("pdf_retry_after"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
  },
  (t) => [
    unique("buy_receipt_branch_doc_no").on(t.branchId, t.docNo),
    index("buy_receipt_branch_date_idx").on(t.branchId, t.date),
    index("buy_receipt_customer_idx").on(t.customerId),
    check("buy_receipt_total_weight_positive", sql`${t.totalWeight} > 0`),
    check("buy_receipt_total_amount_positive", sql`${t.totalAmount} > 0`),
  ],
);

export const buyLine = pgTable(
  "buy_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => buyReceipt.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    metalId: uuid("metal_id")
      .notNull()
      .references(() => metal.id),
    weightG: grams("weight_g").notNull(),
    amount: money("amount").notNull(),
    pricePerG: money("price_per_g").notNull(),
    assessmentAmount: money("assessment_amount"),
    purityPercent: numeric("purity_percent", { precision: 6, scale: 3 }),
  },
  (t) => [
    unique("buy_line_receipt_line_no").on(t.receiptId, t.lineNo),
    check("buy_line_weight_positive", sql`${t.weightG} > 0`),
    check("buy_line_amount_positive", sql`${t.amount} > 0`),
  ],
);

export const payment = pgTable(
  "payment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => buyReceipt.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    bank: text("bank"),
    amount: money("amount").notNull(),
  },
  (t) => [check("payment_amount_positive", sql`${t.amount} > 0`)],
);

export const stockMovement = pgTable(
  "stock_movement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    metalId: uuid("metal_id")
      .notNull()
      .references(() => metal.id),
    date: date("date").notNull(),
    grams: grams("grams").notNull(),
    sourceReceiptId: uuid("source_receipt_id").references(() => buyReceipt.id),
    createdAt: createdAt(),
  },
  (t) => [index("stock_movement_branch_metal_date_idx").on(t.branchId, t.metalId, t.date)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id").references(() => user.id),
    action: text("action").notNull(),
    tableName: text("table_name").notNull(),
    rowId: text("row_id").notNull(),
    diff: jsonb("diff"),
    at: tz("at").notNull().defaultNow(),
  },
  (t) => [index("audit_log_table_row_idx").on(t.tableName, t.rowId)],
);

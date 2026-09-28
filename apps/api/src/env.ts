import { isValidNationalId } from "@ong/core";
import { z } from "zod";

const PLACEHOLDER = /change-me|local-dev-only/i;
/** รหัสผ่าน Gotenberg ใน .env.example / docker-compose.yml — ใช้ได้แค่เครื่อง dev */
const EXAMPLE_GOTENBERG_PASSWORD = "ongongong";

/** ข้อความที่ต้องมี (ตัดช่องว่างหัวท้าย) */
const text = () => z.string().trim().min(1);

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(8787),
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32, "ต้องยาวอย่างน้อย 32 ตัวอักษร (openssl rand -base64 32)"),
    BETTER_AUTH_URL: z.url(),
    // S3-compatible bucket (local = RustFS · Railway = bucket Media) — private
    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    // Railway bucket ใช้ virtual-hosted style (false) · RustFS ต้อง path style (true)
    S3_FORCE_PATH_STYLE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    // Gotenberg (Chromium → PDF) — local = docker compose · Railway = private network + basic auth
    GOTENBERG_URL: z.url({ protocol: /^https?$/, error: "ต้องเป็น URL http(s)" }),
    GOTENBERG_USERNAME: z.string().min(1),
    GOTENBERG_PASSWORD: z.string().min(1),
    // Sarabun ที่แนบไปกับทุกใบ — image ของ api มีที่ ./public/fonts (build ของ apps/web) · dev: ../web/public/fonts
    PDF_FONT_DIR: z.string().trim().min(1).default("public/fonts"),
    // หัวใบรับซื้อ — ข้อมูลกิจการที่พิมพ์บนใบทุกใบ (ไม่ใช่ค่าลับ) · ค่าจริงจากหน้า "ข้อมูลบริษัท" ของระบบเดิม
    // ใบที่เก็บถาวรแก้ย้อนหลังไม่ได้ (R15) — ค่าผิดรูปแบบ = ไม่ start ดีกว่าพิมพ์ผิดลงเอกสารภาษี
    COMPANY_NAME: text(),
    COMPANY_ADDRESS: text(),
    COMPANY_TEL: text(),
    // ไม่มีโทรสาร = เว้นว่าง/ไม่ตั้ง (ใบพิมพ์ "-" แบบระบบเดิม)
    COMPANY_FAX: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || undefined),
    // เลขประจำตัวผู้เสียภาษี 13 หลัก — หลักตรวจสอบสูตรเดียวกับเลขบัตรประชาชน
    COMPANY_TAX_ID: z
      .string()
      .trim()
      .regex(/^\d{13}$/, "ต้องเป็นตัวเลข 13 หลัก ไม่มีขีด/ช่องว่าง")
      .refine(isValidNationalId, "หลักตรวจสอบไม่ถูกต้อง — พิมพ์ผิด?"),
  })
  .superRefine((env, ctx) => {
    // production ห้ามใช้ค่าตัวอย่างจาก .env.example
    if (env.NODE_ENV !== "production") return;
    if (PLACEHOLDER.test(env.BETTER_AUTH_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["BETTER_AUTH_SECRET"], message: "ยังเป็นค่าตัวอย่าง — ตั้งค่าลับจริง" });
    }
    if (PLACEHOLDER.test(env.GOTENBERG_PASSWORD) || env.GOTENBERG_PASSWORD === EXAMPLE_GOTENBERG_PASSWORD) {
      ctx.addIssue({ code: "custom", path: ["GOTENBERG_PASSWORD"], message: "ยังเป็นค่าตัวอย่าง — ตั้งค่าลับจริง" });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** อ่าน env ครั้งเดียวตอนเริ่ม — ค่าไม่ครบ/ผิดรูปแบบ = หยุดทันที ไม่รันแบบครึ่ง ๆ กลาง ๆ */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid environment — ${issues}`);
  }
  return parsed.data;
}

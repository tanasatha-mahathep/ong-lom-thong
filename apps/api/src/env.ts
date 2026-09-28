import { z } from "zod";

const PLACEHOLDER = /change-me|local-dev-only/i;

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
  })
  .superRefine((env, ctx) => {
    // production ห้ามใช้ค่าตัวอย่างจาก .env.example
    if (env.NODE_ENV === "production" && PLACEHOLDER.test(env.BETTER_AUTH_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["BETTER_AUTH_SECRET"], message: "ยังเป็นค่าตัวอย่าง — ตั้งค่าลับจริง" });
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

import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";

// ค่าตาม .env.example (local dev) — ข้อมูลกิจการจริงจากหน้า "ข้อมูลบริษัท" ของระบบเดิม (พิมพ์บนใบทุกใบ ไม่ใช่ค่าลับ)
const EXAMPLE = {
  DATABASE_URL: "postgres://ong:ong@localhost:5432/ong",
  BETTER_AUTH_SECRET: "local-dev-only-secret-change-me-0123456789",
  BETTER_AUTH_URL: "http://localhost:5173",
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "auto",
  S3_BUCKET: "ong",
  S3_ACCESS_KEY: "ong",
  S3_SECRET_KEY: "ongongong",
  GOTENBERG_URL: "http://localhost:3000",
  GOTENBERG_USERNAME: "ong",
  GOTENBERG_PASSWORD: "ongongong",
  COMPANY_NAME: "โอเอ็นจี หลอมทอง",
  COMPANY_ADDRESS: "156/7 ถนนพังงา ตำบลตลาดใหญ่ อำเภอเมืองภูเก็ต จังหวัดภูเก็ต 83000",
  COMPANY_TEL: "0654249514",
  COMPANY_FAX: "",
  COMPANY_TAX_ID: "3839900461751",
};
// production ต้องมีค่าลับจริง — ค่าสมมติสำหรับเทสต์
const PRODUCTION = {
  ...EXAMPLE,
  NODE_ENV: "production",
  BETTER_AUTH_SECRET: "production-like-auth-secret-for-tests-0123",
  GOTENBERG_PASSWORD: "production-like-gotenberg-password-for-tests",
};

const problem = (source: Record<string, string | undefined>) => {
  try {
    loadEnv(source);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

describe("loadEnv — Gotenberg + หัวใบรับซื้อ", () => {
  it("ค่าตาม .env.example ผ่าน · ตัดช่องว่าง · ไม่มีโทรสาร = undefined", () => {
    const env = loadEnv({ ...EXAMPLE, COMPANY_NAME: "  โอเอ็นจี หลอมทอง  " });
    expect(env.GOTENBERG_URL).toBe("http://localhost:3000");
    expect(env.COMPANY_NAME).toBe("โอเอ็นจี หลอมทอง");
    expect(env.COMPANY_TAX_ID).toBe("3839900461751");
    expect(env.COMPANY_FAX).toBeUndefined();
    expect(loadEnv({ ...EXAMPLE, COMPANY_FAX: undefined }).COMPANY_FAX).toBeUndefined();
    expect(loadEnv({ ...EXAMPLE, COMPANY_FAX: " 076-000000 " }).COMPANY_FAX).toBe("076-000000");
  });

  it("ขาดค่าที่ต้องพิมพ์บนใบ → ไม่ start", () => {
    for (const name of ["COMPANY_NAME", "COMPANY_ADDRESS", "COMPANY_TEL", "COMPANY_TAX_ID"]) {
      expect(problem({ ...EXAMPLE, [name]: undefined }), name).toContain(name);
      expect(problem({ ...EXAMPLE, [name]: "   " }), name).toContain(name);
    }
    for (const name of ["GOTENBERG_URL", "GOTENBERG_USERNAME", "GOTENBERG_PASSWORD"]) {
      expect(problem({ ...EXAMPLE, [name]: undefined }), name).toContain(name);
    }
  });

  it("เลขผู้เสียภาษีต้อง 13 หลักและหลักตรวจสอบถูก — พิมพ์ผิดแล้วจะติดใบที่แก้ไม่ได้", () => {
    expect(problem({ ...EXAMPLE, COMPANY_TAX_ID: "3839900461752" })).toMatch(/COMPANY_TAX_ID: หลักตรวจสอบ/);
    expect(problem({ ...EXAMPLE, COMPANY_TAX_ID: "3-8399-00461-75-1" })).toMatch(
      /COMPANY_TAX_ID: ต้องเป็นตัวเลข 13 หลัก/,
    );
    expect(problem({ ...EXAMPLE, COMPANY_TAX_ID: "383990046175" })).toContain("COMPANY_TAX_ID");
  });

  it("GOTENBERG_URL ต้องเป็น http(s)", () => {
    expect(problem({ ...EXAMPLE, GOTENBERG_URL: "gotenberg:3000" })).toContain("GOTENBERG_URL");
    expect(problem({ ...EXAMPLE, GOTENBERG_URL: "ftp://gotenberg:3000" })).toContain("GOTENBERG_URL");
    expect(loadEnv({ ...EXAMPLE, GOTENBERG_URL: "http://gotenberg.railway.internal:3000" }).GOTENBERG_URL).toBe(
      "http://gotenberg.railway.internal:3000",
    );
  });

  it("production ปฏิเสธรหัสผ่าน Gotenberg ตัวอย่าง (เหมือน BETTER_AUTH_SECRET)", () => {
    expect(loadEnv(PRODUCTION).NODE_ENV).toBe("production");
    expect(problem({ ...PRODUCTION, GOTENBERG_PASSWORD: "ongongong" })).toMatch(
      /GOTENBERG_PASSWORD: ยังเป็นค่าตัวอย่าง/,
    );
    expect(problem({ ...PRODUCTION, GOTENBERG_PASSWORD: "local-dev-only-change-me" })).toMatch(/GOTENBERG_PASSWORD/);
    expect(problem({ ...PRODUCTION, BETTER_AUTH_SECRET: EXAMPLE.BETTER_AUTH_SECRET })).toMatch(/BETTER_AUTH_SECRET/);
    // เครื่อง dev ใช้ค่าตัวอย่างได้
    expect(problem(EXAMPLE)).toBeNull();
  });

  it("ข้อความ error ไม่มีค่าลับ", () => {
    const message = problem({ ...PRODUCTION, GOTENBERG_PASSWORD: "ongongong", COMPANY_TAX_ID: "x" }) ?? "";
    expect(message).not.toContain("ongongong");
    expect(message).not.toContain(PRODUCTION.BETTER_AUTH_SECRET);
  });
});

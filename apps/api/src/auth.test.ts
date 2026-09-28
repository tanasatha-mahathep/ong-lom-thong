import { session } from "@ong/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Auth, createAuth } from "./auth";
import { type TestApp, databaseAvailable, startTestApp } from "./test/harness";

const available = await databaseAvailable();
const PW = "correct-horse-battery";

/**
 * rate limit ของ sign-in (5 ครั้ง/นาที) ต้องแยกถังตาม IP ของ client ที่ Railway edge เขียนใน X-Real-IP
 * บน Railway: edge เขียน X-Real-IP ทับค่าของ client และแทน X-Forwarded-For ทั้งเส้นด้วย "<client>, <edge>"
 * ในเทสต์ไม่มี edge — X-Real-IP ในเทสต์คือค่าที่ edge เขียน · header อื่นคือสิ่งที่ client ปลอมมาได้
 */
describe.skipIf(!available)("rate limit sign-in ต่อ IP ของ client (X-Real-IP จาก Railway edge)", () => {
  let t: TestApp;
  let auth: Auth;

  beforeAll(async () => {
    t = await startTestApp();
    await t.createUser({ email: "staff@ong.test", password: PW, branch: "00000" });
    // เทสต์อื่นปิด rate limit (NODE_ENV=test) — ไฟล์นี้เปิดแบบ production
    auth = createAuth(t.db, { ...t.env, NODE_ENV: "production" });
  });
  afterAll(async () => {
    await t?.close();
  });

  function signIn(headers: Record<string, string>, password = "wrong-password-0") {
    return auth.handler(
      new Request(`${t.env.BETTER_AUTH_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { origin: t.env.BETTER_AUTH_URL, "content-type": "application/json", ...headers },
        body: JSON.stringify({ email: "staff@ong.test", password }),
      }),
    );
  }
  const statuses = async (n: number, headers: (i: number) => Record<string, string>) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push((await signIn(headers(i))).status);
    return out;
  };

  it("แยกถังตาม X-Real-IP: IP หนึ่งครบ 5 ครั้ง = 429 · อีก IP ยัง login ได้", async () => {
    const a = { "x-real-ip": "198.51.100.10" };
    expect(await statuses(5, () => a)).toEqual([401, 401, 401, 401, 401]);
    const blocked = await signIn(a);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("x-retry-after"))).toBeGreaterThan(0);
    // อีกเครื่อง/อีกสาขา ไม่โดนล็อกตาม
    expect((await signIn({ "x-real-ip": "198.51.100.11" })).status).toBe(401);
    expect((await signIn({ "x-real-ip": "198.51.100.11" }, PW)).status).toBe(200);
  });

  it("ปลอม header อื่นเพื่อเปิดถังใหม่ไม่ได้ — ถังผูกกับ X-Real-IP เท่านั้น", async () => {
    const spoof = (i: number) => ({
      "x-real-ip": "198.51.100.20",
      // รูปเดียวกับที่ Railway ส่งมา + ค่าที่ client ใส่เองได้ (edge ส่งต่อไปตรง ๆ)
      "x-forwarded-for": `203.0.113.${i + 1}, 152.233.15.120`,
      forwarded: `for=192.0.2.${i + 1}`,
      "cf-connecting-ip": `192.0.2.${i + 101}`,
      "true-client-ip": `192.0.2.${i + 151}`,
      "x-client-ip": `192.0.2.${i + 201}`,
    });
    expect(await statuses(5, spoof)).toEqual([401, 401, 401, 401, 401]);
    expect((await signIn(spoof(99))).status).toBe(429);
    // รหัสถูกก็ไม่ผ่านจนกว่าจะครบเวลา
    expect((await signIn(spoof(100), PW)).status).toBe(429);
  });

  it("ไม่มี X-Real-IP: ไม่เชื่อ X-Forwarded-For — ทุก request ลงถังเดียวกัน (ปลอม XFF เปิดถังใหม่ไม่ได้)", async () => {
    const xff = (i: number) => ({ "x-forwarded-for": `203.0.113.${i + 50}` });
    expect(await statuses(5, xff)).toEqual([401, 401, 401, 401, 401]);
    expect((await signIn(xff(99))).status).toBe(429);
  });

  it("session เก็บ IP จาก X-Real-IP ไม่ใช่ X-Forwarded-For ที่ client ส่ง (ใช้ตรวจบน staging ได้)", async () => {
    const res = await signIn({ "x-real-ip": "198.51.100.77", "x-forwarded-for": "203.0.113.200" }, PW);
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    const [row] = await t.db.select().from(session).where(eq(session.token, token));
    expect(row?.ipAddress).toBe("198.51.100.77");
  });
});

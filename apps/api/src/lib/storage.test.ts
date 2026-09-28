import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../env";
import { ObjectExistsError, type Storage, createMemoryStorage, createS3Storage, putNew } from "./storage";

const KEY = "receipts/00000/2026/10/RC6910-0001.pdf";
const bytes = (s: string) => new TextEncoder().encode(s);

describe("putNew — ไฟล์ immutable ไม่เขียนทับ (R15)", () => {
  it("key ใหม่ → เขียน · exists เปลี่ยนเป็น true", async () => {
    const storage = createMemoryStorage();
    expect(await storage.exists(KEY)).toBe(false);
    await putNew(storage, KEY, bytes("%PDF-first"), "application/pdf");
    expect(await storage.exists(KEY)).toBe(true);
    expect(await storage.get(KEY)).toEqual({ body: bytes("%PDF-first"), contentType: "application/pdf" });
  });

  it("key มีอยู่แล้ว → ObjectExistsError และไฟล์เดิมไม่เปลี่ยน", async () => {
    const storage = createMemoryStorage();
    await putNew(storage, KEY, bytes("%PDF-first"), "application/pdf");

    const err = await putNew(storage, KEY, bytes("%PDF-second"), "application/pdf").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ObjectExistsError);
    expect(err).toMatchObject({ key: KEY });
    expect((await storage.get(KEY))?.body).toEqual(bytes("%PDF-first"));
  });

  it("เช็กการมีอยู่ไม่ได้ (เช่น bucket ตอบ 403) → ล้ม ไม่ PUT", async () => {
    const puts: string[] = [];
    const storage: Storage = {
      exists: () => Promise.reject(new Error("403 Forbidden")),
      put: (key) => {
        puts.push(key);
        return Promise.resolve();
      },
      get: () => Promise.resolve(null),
    };
    await expect(putNew(storage, KEY, bytes("%PDF-x"), "application/pdf")).rejects.toThrow("403");
    expect(puts).toEqual([]);
  });
});

/**
 * S3 ปลอมระดับ HTTP — ตรวจว่า SDK แปลงคำตอบ HEAD ถูก (404 = ไม่มี · 403 = ไม่รู้ → throw)
 * และ putNew ไม่ส่ง PUT เลยเมื่อ object มีอยู่แล้ว
 */
describe("createS3Storage — exists (HEAD) กับ S3 ปลอม", () => {
  const requests: string[] = [];
  const headStatus = new Map<string, number>();
  let storage: Storage;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    requests.push(`${req.method} ${req.url}`);
    req.resume();
    req.on("end", () => {
      const key = decodeURIComponent((req.url ?? "").replace(/^\/ong\//, "").split("?")[0] ?? "");
      res.statusCode = req.method === "HEAD" ? (headStatus.get(key) ?? 404) : 200;
      res.end();
    });
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const env = loadEnv({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://unused@localhost/unused",
      BETTER_AUTH_SECRET: "test-only-secret-0123456789abcdefghij",
      BETTER_AUTH_URL: "http://localhost:8787",
      S3_ENDPOINT: `http://127.0.0.1:${port}`,
      S3_REGION: "us-east-1",
      S3_BUCKET: "ong",
      S3_ACCESS_KEY: "test",
      S3_SECRET_KEY: "test",
      S3_FORCE_PATH_STYLE: "true",
      GOTENBERG_URL: "http://gotenberg.invalid",
      GOTENBERG_USERNAME: "test",
      GOTENBERG_PASSWORD: "test",
      COMPANY_NAME: "ร้านทดสอบ",
      COMPANY_ADDRESS: "1 ถนนทดสอบ",
      COMPANY_TEL: "0800000000",
      COMPANY_TAX_ID: "1234567890121",
    });
    storage = createS3Storage(env);
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("200 = มี · 404 = ไม่มี · 403 = throw (ไม่เดาว่าไม่มี)", async () => {
    headStatus.set("present.pdf", 200);
    headStatus.set("forbidden.pdf", 403);
    expect(await storage.exists("present.pdf")).toBe(true);
    expect(await storage.exists("missing.pdf")).toBe(false);
    await expect(storage.exists("forbidden.pdf")).rejects.toThrow();
  });

  it("putNew: มีอยู่แล้ว → ไม่ส่ง PUT · ยังไม่มี → HEAD แล้ว PUT", async () => {
    headStatus.set(KEY, 200);
    requests.length = 0;
    await expect(putNew(storage, KEY, bytes("%PDF-x"), "application/pdf")).rejects.toBeInstanceOf(ObjectExistsError);
    expect(requests.map((r) => r.split(" ")[0])).toEqual(["HEAD"]);

    const fresh = "receipts/00000/2026/10/RC6910-0002.pdf";
    requests.length = 0;
    await putNew(storage, fresh, bytes("%PDF-x"), "application/pdf");
    expect(requests.map((r) => r.split("?")[0])).toEqual([`HEAD /ong/${fresh}`, `PUT /ong/${fresh}`]);
  });
});

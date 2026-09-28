import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../env";
import { sha256Hex } from "./pdfArchive";
import {
  ObjectExistsError,
  type S3Timeouts,
  type Storage,
  createMemoryStorage,
  createS3Storage,
  putNew,
} from "./storage";

const KEY = "receipts/00000/2026/10/RC6910-0001.pdf";
const bytes = (s: string) => new TextEncoder().encode(s);
const OWNER = { "receipt-id": "3f0c9a52-8a8e-4c4e-9f43-2b7d4f1f8a10", kind: "receipt" };
const quiet = { warn: () => {} };

describe("putNew — ไฟล์ immutable ไม่เขียนทับ (R15)", () => {
  it("key ใหม่ → เขียนพร้อม metadata เจ้าของ + sha256 · exists คืน metadata", async () => {
    const storage = createMemoryStorage();
    expect(await storage.exists(KEY)).toBeNull();
    const { sha256 } = await putNew(storage, KEY, bytes("%PDF-first"), "application/pdf", OWNER);
    expect(sha256).toBe(sha256Hex(bytes("%PDF-first")));
    const metadata = { ...OWNER, sha256 };
    expect(await storage.exists(KEY)).toEqual({ contentType: "application/pdf", metadata });
    expect(await storage.get(KEY)).toEqual({ body: bytes("%PDF-first"), contentType: "application/pdf", metadata });
  });

  it("key มีอยู่แล้ว → ObjectExistsError พร้อม metadata ของไฟล์เดิม · ไฟล์เดิมไม่เปลี่ยน", async () => {
    const storage = createMemoryStorage();
    await putNew(storage, KEY, bytes("%PDF-first"), "application/pdf", OWNER);

    const err = await putNew(storage, KEY, bytes("%PDF-second"), "application/pdf", {
      "receipt-id": "someone-else",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ObjectExistsError);
    expect(err).toMatchObject({ key: KEY, metadata: OWNER });
    expect(await storage.get(KEY)).toMatchObject({ body: bytes("%PDF-first"), metadata: OWNER });
    // putImmutable เองก็ไม่เขียนทับ (แบบ If-None-Match)
    await expect(storage.putImmutable(KEY, bytes("%PDF-third"), "application/pdf", {})).rejects.toBeInstanceOf(
      ObjectExistsError,
    );
  });

  it("put() ธรรมดาเขียน key เก็บถาวร (receipts/ · idcards/) ไม่ได้ — ต้องผ่าน putNew เท่านั้น", async () => {
    const storage = createMemoryStorage();
    await expect(storage.put(KEY, bytes("%PDF-x"), "application/pdf")).rejects.toThrow(/putNew/);
    await expect(storage.put("idcards/00000/2026/10/RC6910-0001.pdf", bytes("x"), "application/pdf")).rejects.toThrow(
      /putNew/,
    );
    expect(await storage.exists(KEY)).toBeNull();
    await storage.put("photos/c1/a.png", bytes("png"), "image/png");
    expect(await storage.get("photos/c1/a.png")).toMatchObject({ contentType: "image/png", metadata: {} });
  });

  it("เช็กการมีอยู่ไม่ได้ (เช่น bucket ตอบ 403) → ล้ม ไม่ PUT", async () => {
    const puts: string[] = [];
    const storage: Storage = {
      exists: () => Promise.reject(new Error("403 Forbidden")),
      put: () => Promise.reject(new Error("unused")),
      putImmutable: (key) => {
        puts.push(key);
        return Promise.resolve();
      },
      get: () => Promise.resolve(null),
    };
    await expect(putNew(storage, KEY, bytes("%PDF-x"), "application/pdf", OWNER)).rejects.toThrow("403");
    expect(puts).toEqual([]);
  });
});

// ---------- S3 ปลอมระดับ HTTP (ตรวจสิ่งที่ SDK ส่ง/แปลงจริง) ----------

interface Seen {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
}

async function fakeS3(respond: (req: Seen) => number | "hang") {
  const seen: Seen[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const entry = {
      method: req.method ?? "",
      path: decodeURIComponent((req.url ?? "").split("?")[0] ?? ""),
      headers: req.headers,
    };
    seen.push(entry);
    req.resume();
    req.on("end", () => {
      const status = respond(entry);
      if (status === "hang") return; // รับ connection แต่ไม่ตอบเลย
      res.statusCode = status;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return { seen, endpoint: `http://127.0.0.1:${port}`, close };
}

const s3Env = (endpoint: string) =>
  loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://unused@localhost/unused",
    BETTER_AUTH_SECRET: "test-only-secret-0123456789abcdefghij",
    BETTER_AUTH_URL: "http://localhost:8787",
    S3_ENDPOINT: endpoint,
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

describe("createS3Storage — HEAD / If-None-Match กับ S3 ปลอม", () => {
  const headStatus = new Map<string, number>();
  let putStatus: (s: Seen) => number = () => 200;
  let s3: Awaited<ReturnType<typeof fakeS3>>;
  let storage: Storage;

  beforeAll(async () => {
    s3 = await fakeS3((req) => {
      const key = req.path.replace(/^\/ong\//, "");
      if (req.method === "HEAD") return headStatus.get(key) ?? 404;
      if (req.method === "PUT") return putStatus(req);
      return 200;
    });
    storage = createS3Storage(s3Env(s3.endpoint), { log: quiet });
  });
  afterAll(() => s3.close());

  it("HEAD: 200 = มี · 404 = ไม่มี · 403 = throw (ไม่เดาว่าไม่มี)", async () => {
    headStatus.set("present.pdf", 200);
    headStatus.set("forbidden.pdf", 403);
    expect(await storage.exists("present.pdf")).toMatchObject({ metadata: {} });
    expect(await storage.exists("missing.pdf")).toBeNull();
    await expect(storage.exists("forbidden.pdf")).rejects.toThrow();
  });

  it("putNew: มีอยู่แล้ว → ไม่ส่ง PUT · ยังไม่มี → PUT แบบ If-None-Match พร้อม metadata เจ้าของ + sha256", async () => {
    headStatus.set(KEY, 200);
    s3.seen.length = 0;
    await expect(putNew(storage, KEY, bytes("%PDF-x"), "application/pdf")).rejects.toBeInstanceOf(ObjectExistsError);
    expect(s3.seen.map((r) => r.method)).toEqual(["HEAD"]);

    const fresh = "receipts/00000/2026/10/RC6910-0002.pdf";
    s3.seen.length = 0;
    await putNew(storage, fresh, bytes("%PDF-x"), "application/pdf", OWNER);
    expect(s3.seen.map((r) => `${r.method} ${r.path}`)).toEqual([`HEAD /ong/${fresh}`, `PUT /ong/${fresh}`]);
    expect(s3.seen[1]?.headers).toMatchObject({
      "if-none-match": "*",
      "x-amz-meta-receipt-id": OWNER["receipt-id"],
      "x-amz-meta-kind": "receipt",
      "x-amz-meta-sha256": sha256Hex(bytes("%PDF-x")),
    });
  });

  it("มีคนเขียนตัดหน้าระหว่าง HEAD กับ PUT → bucket ตอบ 412 → ObjectExistsError (ไม่เขียนทับ)", async () => {
    const key = "receipts/00000/2026/10/RC6910-0003.pdf";
    putStatus = (req) => (req.headers["if-none-match"] === "*" ? 412 : 200);
    headStatus.delete(key);
    s3.seen.length = 0;
    const err = await putNew(storage, key, bytes("%PDF-x"), "application/pdf", OWNER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ObjectExistsError);
    expect(s3.seen.filter((r) => r.method === "PUT")).toHaveLength(1); // ไม่ลอง PUT แบบไม่มีเงื่อนไขซ้ำ
    putStatus = () => 200;
  });

  it("put() ของ S3 ก็ปฏิเสธ key เก็บถาวรก่อนส่ง request", async () => {
    s3.seen.length = 0;
    await expect(storage.put(KEY, bytes("%PDF-x"), "application/pdf")).rejects.toThrow(/putNew/);
    expect(s3.seen).toEqual([]);
  });
});

describe("createS3Storage — bucket ที่ไม่รู้จัก If-None-Match", () => {
  it("ตอบ 501 → เขียนแบบ HEAD-then-PUT แทน และจำไว้ ไม่ลอง header นี้ซ้ำ", async () => {
    const s3 = await fakeS3((req) => {
      if (req.method === "HEAD") return 404;
      if (req.method === "PUT") return req.headers["if-none-match"] ? 501 : 200;
      return 200;
    });
    try {
      const storage = createS3Storage(s3Env(s3.endpoint), { log: quiet });
      await putNew(storage, "receipts/a/2026/10/RC1.pdf", bytes("%PDF-1"), "application/pdf", OWNER);
      await putNew(storage, "receipts/a/2026/10/RC2.pdf", bytes("%PDF-2"), "application/pdf", OWNER);
      const puts = s3.seen.filter((r) => r.method === "PUT").map((r) => r.headers["if-none-match"] ?? "plain");
      expect(puts).toEqual(["*", "plain", "plain"]);
    } finally {
      await s3.close();
    }
  });
});

describe("createS3Storage — timeout (B1)", () => {
  it("bucket รับ connection แต่ไม่ตอบ → get/exists/putNew ล้มภายในเวลา ไม่ค้าง", async () => {
    const s3 = await fakeS3(() => "hang");
    const timeouts: S3Timeouts = { connectionMs: 200, requestMs: 300, socketMs: 300 };
    try {
      const storage = createS3Storage(s3Env(s3.endpoint), { timeouts, log: quiet });
      const started = Date.now();
      await expect(storage.get("photos/x.png")).rejects.toThrow();
      await expect(storage.exists("photos/x.png")).rejects.toThrow();
      await expect(putNew(storage, KEY, bytes("%PDF-x"), "application/pdf", OWNER)).rejects.toThrow();
      // SDK ลอง 2 ครั้งต่อคำสั่ง (maxAttempts) — จบในไม่กี่วินาทีเมื่อ timeout สั้น (ค่าจริง 30 วินาที/ครั้ง)
      expect(Date.now() - started).toBeLessThan(15_000);
    } finally {
      await s3.close();
    }
  }, 20_000);
});

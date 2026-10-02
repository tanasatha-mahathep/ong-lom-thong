import { maskNationalId } from "@ong/core";
import { type ReceiptData, renderReceiptHtml } from "@ong/core/receipt";
import { auditLog, branch, buyLine, buyReceipt, customer, goldPrice, metal, stockMovement } from "@ong/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createManualTasks } from "../lib/background";
import { type HtmlToPdfInput, type PdfRenderer, createGotenbergClient } from "../lib/gotenberg";
import { idcardPdfKey, receiptPdfKey, sha256Hex } from "../lib/pdfArchive";
import type { Storage } from "../lib/storage";
import {
  backoffMs,
  companyFromEnv,
  createReceiptPdfService,
  loadPdfFonts,
  loadReceiptSource,
  toReceiptData,
} from "../services/receiptPdf";
import {
  TEST_FONT_DIR,
  TEST_GOTENBERG,
  type TestApp,
  databaseAvailable,
  gotenbergAvailable,
  startTestApp,
} from "../test/harness";

const available = await databaseAvailable();
const PW = "correct-horse-battery";

// เลขบัตรสมมติที่ checksum ถูก — ห้ามใช้ข้อมูลลูกค้าจริง (CLAUDE.md กฎ 8)
const ID_A = "1103700123458";
const ID_C = "5109900112237";
// 10:00 น. วันที่ 5 ต.ค. 2569 เวลาไทย → งวดเลขที่ 6910 · โฟลเดอร์ 2026/10
const NOW = new Date("2026-10-05T03:00:00Z");
const TODAY = "2026-10-05";
const NO_UUID = "00000000-0000-4000-8000-000000000000";
const PNG_1X1 = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const PHOTO_KEY = "photos/a/card.png";
const enc = (s: string) => new TextEncoder().encode(s);

/**
 * ตารางรายการของใบรับซื้อใน HTML ที่ส่งให้ Gotenberg → ข้อความทุกช่องของทุกแถว (ชื่อรายการ · ปริมาณ · หน่วย · ราคาต่อหน่วย · ราคารวม)
 * อ่านจาก markup ที่พิมพ์จริง ไม่เรียกตัวรวมแถวของ @ong/core ซ้ำ (ไม่ใช้โค้ดที่ถูกเทสต์เป็นเฉลย)
 */
function itemRows(html: string | undefined): string[][] {
  const body = /<table class="items">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/.exec(html ?? "")?.[1];
  if (body === undefined) throw new Error("ไม่พบตารางรายการในใบรับซื้อ");
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((tr) =>
    [...(tr[1] ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((td) => td[1] ?? ""),
  );
}

interface Saved {
  id: string;
  doc_no: string;
  pdf_status: string;
}

/** ผู้ใช้ทุกบทบาท + ลูกค้า (มี/ไม่มีรูปบัตร) + ราคาทองวันนี้ */
async function seed(t: TestApp) {
  const cookies: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  const accounts = [
    { who: "staff", branch: "00000" },
    { who: "staff2", branch: "00002" },
    { who: "manager", branch: "00000", role: "manager" as const },
    { who: "manager2", branch: "00002", role: "manager" as const },
    { who: "acct", branch: "00000", role: "accounting" as const },
    { who: "acct2", branch: "00002", role: "accounting" as const },
    { who: "admin", branch: "00000", role: "admin" as const, viewAll: true },
    { who: "nobranch" },
  ];
  for (const a of accounts) {
    userIds[a.who] = (await t.createUser({ email: `${a.who}@ong.test`, password: PW, ...a })).id;
    cookies[a.who] = await t.login(`${a.who}@ong.test`, PW);
  }
  const metals = Object.fromEntries((await t.db.select().from(metal)).map((m) => [m.code, m.id]));
  await t.db.insert(goldPrice).values([
    // เงินรับซื้อต่อกรัมตั้งที่ราคากลางเท่านั้น (ทุกสาขาใช้ร่วม) — ฐานของแถวเงิน
    { date: TODAY, barSell: "67850", barBuy: "67650", jewelryBuy: "64268", silverPerG: "45.00" },
    { date: "2026-09-30", barSell: "67000", barBuy: "66800", jewelryBuy: "63460" },
  ]);
  // เปิดบิลได้เฉพาะสาขาที่ตั้งรหัสสาขาสรรพากรแล้ว (#53) — seed ตั้งให้สำนักงานใหญ่เท่านั้น
  for (const code of ["00001", "00002"]) {
    await t.db.update(branch).set({ taxBranchCode: code }).where(eq(branch.code, code));
  }
  await t.storage.put(PHOTO_KEY, PNG_1X1, "image/png");
  const [a, c] = await t.db
    .insert(customer)
    .values([
      {
        nationalId: ID_A,
        nameTh: "นายทดสอบ พีดีเอฟ",
        address: "1 ถ.ทดสอบ ต.ในเมือง อ.เมือง จ.ขอนแก่น",
        cardExpireText: "31/12/2574",
        photoKey: PHOTO_KEY,
      },
      { nationalId: ID_C, nameTh: "นายไม่มี รูปบัตร", cardExpireText: "31/12/2574" },
    ])
    .returning({ id: customer.id });
  return { cookies, userIds, metals, custA: a?.id ?? "", custC: c?.id ?? "" };
}

describe.skipIf(!available)("PDF เก็บถาวรของบิล (spec §9.2 · R12 · R13 · R15) — /api/buy/:id/…", () => {
  let t: TestApp;
  let s: Awaited<ReturnType<typeof seed>>;
  let keySeq = 0;
  /** ทุก key เก็บถาวรที่ถูกเขียน (ตรวจว่าไม่มีไฟล์ไหนถูกเขียนสองครั้ง) */
  const puts: string[] = [];
  /** เขียนตรงโดยไม่นับ — จำลองไฟล์จากรอบก่อน/ผู้เขียนอื่น/การแก้ไฟล์ */
  let rawPut: TestApp["storage"]["putImmutable"];

  beforeAll(async () => {
    // งานเบื้องหลังรันจริงแบบ production — เทสต์รอด้วย t.tasks.idle()
    t = await startTestApp({ now: () => NOW, pdfTasks: "auto" });
    s = await seed(t);
    rawPut = t.storage.putImmutable.bind(t.storage);
    // นับเฉพาะการเขียนที่สำเร็จ (ครั้งที่ถูกปฏิเสธเพราะมีไฟล์อยู่แล้วไม่นับ)
    t.storage.putImmutable = async (key, body, type, metadata) => {
      await rawPut(key, body, type, metadata);
      puts.push(key);
    };
  });
  afterAll(async () => {
    await t?.close();
  });

  /**
   * บิลตั้งต้น: ทอง 96.5% 5.860 ก. ไม่หัก — ราคาระบบคิดเอง (UAT 30 ก.ย. 2569) จากทองแท่งรับซื้อ 67,650 ของวันนี้:
   * ⌊67650 × 0.0656 × 0.965 = 4282.5156⌋ = 4,282/ก. → ⌊4282 × 5.86 = 25,092.52⌋ = 25,092.00
   */
  const save = async (over: Record<string, unknown> = {}, who = "staff") => {
    const res = await t.request("/api/buy", {
      cookie: s.cookies[who],
      body: {
        idempotency_key: `pdf-test-key-${String(++keySeq).padStart(6, "0")}`,
        customer_id: s.custA,
        lines: [{ metal_id: s.metals.gold, weight_g: "5.860", purity_percent: "96.5" }],
        payments: [{ method: "cash", amount: "25092" }],
        ...over,
      },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return (await res.json()) as Saved;
  };
  const row = async (id: string) => {
    const [r] = await t.db.select().from(buyReceipt).where(eq(buyReceipt.id, id));
    if (!r) throw new Error(`no receipt ${id}`);
    return r;
  };
  const get = (path: string, who?: string) =>
    t.request(`/api/buy${path}`, { cookie: who ? s.cookies[who] : undefined });
  const post = (path: string, who: string, body?: unknown) =>
    t.request(`/api/buy${path}`, { method: "POST", cookie: s.cookies[who], body });
  const stored = async (key: string | null) => (key ? (await t.storage.get(key))?.body : undefined);
  const bytes = async (res: Response) => new Uint8Array(await res.arrayBuffer());
  const audits = (action: string, rowId: string) =>
    t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, action), eq(auditLog.rowId, rowId)));

  let billA: Saved; // ลูกค้ามีรูปบัตร — ใบ + สำเนาบัตร ready

  it("POST /api/buy ตอบทันที (pending) ไม่รอ Gotenberg · งานเบื้องหลังเก็บใบ + สำเนาบัตรแยกไฟล์", async () => {
    const release = t.fake.hold(); // Gotenberg ค้าง — request ต้องไม่ค้างตาม
    billA = await save();
    expect(billA).toMatchObject({ doc_no: "RC6910-0001", pdf_status: "pending" });
    expect((await row(billA.id)).pdfStatus).toBe("pending");
    release();
    await t.tasks.idle();

    const r = await row(billA.id);
    expect(r).toMatchObject({
      pdfStatus: "ready",
      pdfKey: receiptPdfKey({ branchCode: "00000", date: TODAY, docNo: "RC6910-0001" }),
      pdfGeneratedAt: NOW,
      idcardStatus: "ready",
      idcardPdfKey: idcardPdfKey({ branchCode: "00000", date: TODAY, docNo: "RC6910-0001" }),
      voidPdfStatus: "none",
    });
    expect(r.pdfKey).toBe("receipts/00000/2026/10/RC6910-0001.pdf");
    expect(r.pdfSha256).toBe(sha256Hex((await stored(r.pdfKey)) ?? new Uint8Array()));
    expect(r.idcardSha256).toBe(sha256Hex((await stored(r.idcardPdfKey)) ?? new Uint8Array()));

    // ใบรับซื้อ: เลขบัตรเต็มบน PDF (R13) + ฟอนต์แนบ · สำเนาบัตร: รูปบัตรแนบเป็นไฟล์แยก
    const receiptCall = t.fake.calls.find((c) => c.trace === "RC6910-0001");
    expect(receiptCall?.html).toContain(ID_A);
    // ชื่อรายการพิมพ์ค่าบริสุทธิ์ (หัก 0 ไม่พิมพ์ "หัก") · 25,092.00 ÷ 5.860 = 4,281.911… → 4,281.91
    expect(itemRows(receiptCall?.html)).toEqual([["ทอง 96.5%", "5.860", "กรัม", "4,281.91", "25,092.00"]]);
    expect(receiptCall?.html).toContain("สองหมื่นห้าพันเก้าสิบสองบาทถ้วน");
    expect(receiptCall?.files?.map((f) => f.name)).toEqual(["Sarabun-Regular.ttf", "Sarabun-Bold.ttf"]);
    const idcardCall = t.fake.calls.find((c) => c.trace === "RC6910-0001-idcard");
    expect(idcardCall?.html).toContain('src="card.png"');
    expect(idcardCall?.files?.map((f) => f.name)).toEqual(["Sarabun-Regular.ttf", "Sarabun-Bold.ttf", "card.png"]);
    expect(idcardCall?.files?.[2]?.data).toEqual(PNG_1X1);
  });

  it("GET /pdf: ไฟล์เดียวกับที่เก็บ · inline · no-store · nosniff", async () => {
    const res = await get(`/${billA.id}/pdf`, "staff");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="RC6910-0001.pdf"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await bytes(res)).toEqual(await stored((await row(billA.id)).pdfKey));
    expect((await get(`/${billA.id}/pdf`, "acct")).status).toBe(200); // accounting อ่านได้
  });

  it("GET /pdf: สิทธิ์และขอบเขตสาขา (fail-closed)", async () => {
    expect((await get(`/${billA.id}/pdf`)).status).toBe(401);
    expect((await get(`/${billA.id}/pdf`, "nobranch")).status).toBe(403);
    expect((await get(`/${billA.id}/pdf`, "staff2")).status).toBe(404); // สาขาอื่น = ไม่บอกว่ามี
    expect((await get(`/${billA.id}/pdf`, "acct2")).status).toBe(404);
    expect((await get(`/${NO_UUID}/pdf`, "staff")).status).toBe(404);
    expect((await get("/not-a-uuid/pdf", "staff")).status).toBe(404);
    expect((await get(`/${billA.id}/pdf?version=bogus`, "staff")).status).toBe(400);
    expect((await get(`/${billA.id}/pdf?version=void`, "staff")).status).toBe(404); // บิลยังไม่ยกเลิก
  });

  it("สำเนาบัตร: accounting/admin เท่านั้น · audit ทุกครั้งที่เปิด · สาขาอื่น 404", async () => {
    expect((await get(`/${billA.id}/idcard`, "staff")).status).toBe(403);
    expect((await get(`/${billA.id}/idcard`, "manager")).status).toBe(403);
    expect((await get(`/${billA.id}/idcard`, "acct2")).status).toBe(404);
    expect((await get(`/${billA.id}/idcard`)).status).toBe(401);
    expect(await audits("buy.idcard_view", billA.id)).toHaveLength(0);

    for (const who of ["acct", "acct", "admin"]) {
      const res = await get(`/${billA.id}/idcard`, who);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toBe('inline; filename="RC6910-0001_idcard.pdf"');
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await bytes(res)).toEqual(await stored((await row(billA.id)).idcardPdfKey));
    }
    const views = await audits("buy.idcard_view", billA.id);
    expect(views.map((v) => v.userId).sort()).toEqual([s.userIds.acct, s.userIds.acct, s.userIds.admin].sort());
  });

  // lib/fetchSite.ts ต่อจริงในแอปและอยู่ก่อน handler ที่ลง audit — ลิงก์จากเว็บอื่นพา browser ที่ login อยู่มาโหลด
  // ไฟล์ไม่ได้ และไม่ทิ้ง audit ที่ดูเหมือนพนักงานเปิดเอง (cookie SameSite=Lax ยังถูกแนบมากับ top-level GET)
  it("Sec-Fetch-Site: cross-site เข้าสำเนาบัตร/ใบรับซื้อ = 403 ไม่ได้ไฟล์ ไม่ลง audit", async () => {
    const before = (await audits("buy.idcard_view", billA.id)).length;
    const site = (path: string, who: string, value: string) =>
      t.app.request(`/api/buy${path}`, {
        headers: { origin: "http://localhost:8787", cookie: s.cookies[who] ?? "", "sec-fetch-site": value },
      });

    for (const path of [`/${billA.id}/idcard`, `/${billA.id}/pdf`]) {
      for (const value of ["cross-site", "same-site"]) {
        const res = await site(path, "acct", value);
        expect(res.status, `${path} ${value}`).toBe(403);
        expect(await res.json()).toEqual({ error: "เปิดไฟล์นี้จากเว็บอื่นไม่ได้ — เปิดจากหน้าระบบโดยตรง" });
      }
    }
    expect(await audits("buy.idcard_view", billA.id)).toHaveLength(before);

    // หน้าระบบของเราเอง (same-origin) และ client ที่ไม่ส่ง header เลย ยังใช้ได้ตามปกติ
    expect((await site(`/${billA.id}/idcard`, "acct", "same-origin")).status).toBe(200);
    expect((await site(`/${billA.id}/pdf`, "acct", "none")).status).toBe(200);
    expect((await get(`/${billA.id}/pdf`, "acct")).status).toBe(200);
    expect(await audits("buy.idcard_view", billA.id)).toHaveLength(before + 1);
  });

  it("บิลที่ลูกค้าไม่มีรูปบัตร: ไม่มีสำเนาบัตร (404) · ใบรับซื้อ ready", async () => {
    const bill = await save({ customer_id: s.custC });
    await t.tasks.idle();
    expect(await row(bill.id)).toMatchObject({ pdfStatus: "ready", idcardStatus: "none", idcardPdfKey: null });
    const res = await get(`/${bill.id}/idcard`, "acct");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "บิลนี้ไม่มีสำเนาบัตร" });
  });

  it("Gotenberg ล่ม → failed (บิลบันทึกแล้ว ไม่ใช่ 500) · retry โดย manager → ready · audit", async () => {
    t.fake.failNext(2); // ใบรับซื้อ + สำเนาบัตร
    const bill = await save();
    await t.tasks.idle();
    expect(await row(bill.id)).toMatchObject({ pdfStatus: "failed", idcardStatus: "failed", pdfKey: null });
    const pending = await get(`/${bill.id}/pdf`, "staff");
    expect(pending.status).toBe(409);
    expect(await pending.json()).toMatchObject({ pdf_status: "failed" });
    expect((await get(`/${bill.id}/idcard`, "acct")).status).toBe(409);

    expect((await post(`/${bill.id}/pdf/retry`, "staff")).status).toBe(403);
    expect((await post(`/${bill.id}/pdf/retry`, "acct")).status).toBe(403);
    expect((await post(`/${bill.id}/pdf/retry`, "manager2")).status).toBe(404); // สาขาอื่น
    const res = await post(`/${bill.id}/pdf/retry`, "manager");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pdf_status: "ready", idcard_status: "ready", void_pdf_status: "none" });
    const [audit] = await audits("buy.pdf_retry", bill.id);
    expect(audit).toMatchObject({ userId: s.userIds.manager, tableName: "buy_receipt" });
    expect(audit?.diff).toMatchObject({ before: { pdf_status: "failed", idcard_status: "failed" } });

    // ครบแล้ว = ไม่มีอะไรให้ทำ ไม่ audit เพิ่ม
    expect((await post(`/${bill.id}/pdf/retry`, "manager")).status).toBe(409);
    expect(await audits("buy.pdf_retry", bill.id)).toHaveLength(1);
  });

  it("ข้อมูลบิลขัดกันเอง (ReceiptDataError) → invalid ไม่มีไฟล์ผิดเก็บไว้ · loop ไม่แตะ · แก้แล้วสั่ง retry ได้", async () => {
    t.fake.failNext(1); // รอบแรกยังไม่มีไฟล์
    const bill = await save({ customer_id: s.custC });
    await t.tasks.idle();
    const key = receiptPdfKey({ branchCode: "00000", date: TODAY, docNo: bill.doc_no });
    // จำลองบั๊กตอน map: Σรายการไม่เท่ายอดบิล — renderReceiptHtml ต้องไม่ยอมพิมพ์
    await t.db.update(buyLine).set({ amount: "1.00" }).where(eq(buyLine.receiptId, bill.id));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await t.pdf.archive(bill.id, { manual: true });
    log.mockRestore();
    expect(result).toMatchObject({ pdf_status: "invalid", busy: false });
    expect(await t.storage.get(key)).toBeNull();
    expect(await t.pdf.retryDue({ olderThanMs: 0 })).toBe(0); // ลองซ้ำก็ไม่หาย — ไม่เปลือง Gotenberg

    await t.db.update(buyLine).set({ amount: "25092.00" }).where(eq(buyLine.receiptId, bill.id));
    expect(await t.pdf.archive(bill.id)).toMatchObject({ pdf_status: "invalid" }); // งานอัตโนมัติไม่แตะ invalid
    expect(await t.pdf.archive(bill.id, { manual: true })).toMatchObject({ pdf_status: "ready" });
  });

  it("retry เบื้องหลัง: ล้มแล้ว backoff · ใบที่เพิ่งสร้าง (< 2 นาที) ยังไม่แตะ · พ้นแล้วเข้าคิวเดียวกัน", async () => {
    expect([1, 2, 3, 6, 10].map(backoffMs)).toEqual([120_000, 240_000, 480_000, 3_600_000, 3_600_000]);
    t.fake.failNext(2);
    const bill = await save();
    await t.tasks.idle();
    const failed = await row(bill.id);
    expect(failed).toMatchObject({ pdfStatus: "failed", idcardStatus: "failed", pdfAttempts: 1, pdfLeaseToken: null });
    expect(failed.pdfRetryAfter).not.toBeNull();
    expect(await t.pdf.retryDue({ olderThanMs: 0 })).toBe(0); // ยังไม่พ้น backoff

    const past = new Date(Date.now() - 1000);
    await t.db.update(buyReceipt).set({ pdfRetryAfter: past, createdAt: NOW }).where(eq(buyReceipt.id, bill.id));
    expect(await t.pdf.retryDue()).toBe(0); // เพิ่งสร้างตามนาฬิกาของแอป — งานของ POST อาจยังวิ่ง
    expect(await t.pdf.retryDue({ olderThanMs: 0 })).toBe(1);
    await t.tasks.idle();
    expect(await row(bill.id)).toMatchObject({
      pdfStatus: "ready",
      idcardStatus: "ready",
      pdfAttempts: 0,
      pdfRetryAfter: null,
    });
  });

  it("ผู้เขียนคนเดียวต่อบิล (lease): งานอื่น = busy · ไม่มี transaction ค้างระหว่าง render (B2)", async () => {
    const release = t.fake.hold();
    const bill = await save({ customer_id: s.custC });
    await vi.waitFor(() => expect(t.fake.calls.some((c) => c.trace === bill.doc_no)).toBe(true));
    expect((await row(bill.id)).pdfLeaseToken).not.toBeNull();
    // ระหว่างรอ Gotenberg ไม่มี connection ไหนค้าง "idle in transaction" — pool ว่างให้การขาย
    const [stuck] = await t.db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_stat_activity
          where datname = current_database() and state = 'idle in transaction'`,
    );
    expect(stuck?.n).toBe(0);
    expect(await t.pdf.archive(bill.id)).toMatchObject({ busy: true, pdf_status: "pending" });
    expect(await t.pdf.archive(bill.id, { manual: true })).toMatchObject({ busy: true });
    release();
    await t.tasks.idle();
    expect(await row(bill.id)).toMatchObject({ pdfStatus: "ready", pdfLeaseToken: null, pdfLeaseUntil: null });
    expect(t.fake.calls.filter((c) => c.trace === bill.doc_no)).toHaveLength(1);
    const { pdfKey } = await row(bill.id);
    expect(puts.filter((k) => k === pdfKey)).toHaveLength(1);
  });

  it("lease หมดอายุ (ผู้ถือค้าง) → ผู้เขียนใหม่ทำต่อ · ผู้ถือเดิมบันทึกผลไม่ได้ · ไฟล์เขียนครั้งเดียว", async () => {
    const release = t.fake.hold();
    const bill = await save({ customer_id: s.custC });
    await vi.waitFor(() => expect(t.fake.calls.some((c) => c.trace === bill.doc_no)).toBe(true));
    await t.db
      .update(buyReceipt)
      .set({ pdfLeaseUntil: new Date(Date.now() - 1000) })
      .where(eq(buyReceipt.id, bill.id));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const takeover = t.pdf.archive(bill.id);
    await vi.waitFor(() => expect(t.fake.calls.filter((c) => c.trace === bill.doc_no)).toHaveLength(2));
    release();
    await t.tasks.idle();
    const result = await takeover;
    const logged = log.mock.calls.flat().join(" ");
    log.mockRestore();
    expect(result).toMatchObject({ pdf_status: "ready" });
    const r = await row(bill.id);
    expect(r).toMatchObject({ pdfStatus: "ready", pdfLeaseToken: null });
    expect(r.pdfSha256).toBe(sha256Hex((await stored(r.pdfKey)) ?? new Uint8Array()));
    expect(puts.filter((k) => k === r.pdfKey)).toHaveLength(1);
    // ผู้ถือเดิมเช็ก lease ก่อน PUT แล้วพบว่าหลุด — ยกเลิกเอง ไม่เขียนอะไร
    expect(logged).toContain("lease lost before upload");
  });

  it("lease ถูกยึดก่อน PUT → ไม่ PUT เลย · ไม่บันทึกอะไร (ตรวจ+ต่อ lease ทันทีก่อนเขียนทุกไฟล์)", async () => {
    const release = t.fake.hold();
    const bill = await save({ customer_id: s.custC });
    await vi.waitFor(() => expect(t.fake.calls.some((c) => c.trace === bill.doc_no)).toBe(true));
    // ผู้เขียนอื่นยึด lease ระหว่างที่งานนี้ค้างใน Gotenberg
    const other = "11111111-1111-4111-8111-111111111111";
    await t.db
      .update(buyReceipt)
      .set({ pdfLeaseToken: other, pdfLeaseUntil: new Date(Date.now() + 60_000) })
      .where(eq(buyReceipt.id, bill.id));
    const key = receiptPdfKey({ branchCode: "00000", date: TODAY, docNo: bill.doc_no });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    release();
    await t.tasks.idle();
    const logged = log.mock.calls.flat().join(" ");
    log.mockRestore();
    expect(logged).toContain("lease lost before upload");
    expect(puts).not.toContain(key);
    expect(await t.storage.exists(key)).toBeNull();
    expect(await row(bill.id)).toMatchObject({ pdfStatus: "pending", pdfKey: null, pdfLeaseToken: other });
    // ผู้ยึดหายไป (lease ถูกปล่อย) → งานรอบถัดไปทำต่อได้ตามปกติ
    await t.db.update(buyReceipt).set({ pdfLeaseToken: null, pdfLeaseUntil: null }).where(eq(buyReceipt.id, bill.id));
    expect(await t.pdf.archive(bill.id)).toMatchObject({ pdf_status: "ready", busy: false });
  });

  it("มีไฟล์อยู่แล้วใน bucket (รอบก่อนอัปโหลดแต่ DB ไม่ทัน) → รับไฟล์เดิม ไม่ render ทับ", async () => {
    t.fake.failNext(1);
    const bill = await save({ customer_id: s.custC });
    await t.tasks.idle();
    expect((await row(bill.id)).pdfStatus).toBe("failed");
    const key = receiptPdfKey({ branchCode: "00000", date: TODAY, docNo: bill.doc_no });
    const earlier = enc("%PDF-1.4\n% uploaded by an earlier attempt\n%%EOF\n");
    await rawPut(key, earlier, "application/pdf", { "receipt-id": bill.id, kind: "receipt" });

    const renders = t.fake.calls.length;
    expect(await (await post(`/${bill.id}/pdf/retry`, "manager")).json()).toMatchObject({ pdf_status: "ready" });
    expect(t.fake.calls.length).toBe(renders);
    expect(await row(bill.id)).toMatchObject({ pdfKey: key, pdfSha256: sha256Hex(earlier) });
    expect(await stored(key)).toEqual(earlier);
  });

  it("อีกตัวเขียน key เดียวกันก่อนระหว่าง render (ObjectExistsError) → ใช้ไฟล์ของผู้ชนะ", async () => {
    t.fake.failNext(1);
    const bill = await save({ customer_id: s.custC });
    await t.tasks.idle();
    const key = receiptPdfKey({ branchCode: "00000", date: TODAY, docNo: bill.doc_no });
    const winner = enc("%PDF-1.4\n% written by the other writer\n%%EOF\n");
    const racing: PdfRenderer = {
      async htmlToPdf() {
        // ผู้เขียนอีกตัวของบิลเดียวกันอัปโหลดก่อนเรา
        await rawPut(key, winner, "application/pdf", { "receipt-id": bill.id, kind: "receipt" });
        return enc("%PDF-1.4\n% loser\n%%EOF\n");
      },
      health: () => Promise.resolve({ up: true, status: 200 }),
    };
    const other = createReceiptPdfService({
      db: t.db,
      storage: t.storage,
      renderer: racing,
      company: companyFromEnv(t.env),
      fonts: await loadPdfFonts(TEST_FONT_DIR),
      tasks: createManualTasks(),
      now: () => NOW,
    });
    expect(await other.archive(bill.id, { manual: true })).toMatchObject({ pdf_status: "ready" });
    expect(await row(bill.id)).toMatchObject({ pdfKey: key, pdfSha256: sha256Hex(winner) });
    expect(await stored(key)).toEqual(winner);
  });

  it("key เดียวกันเป็นไฟล์ของบิลอื่น (DB restore แล้วเลขที่ซ้ำ) → invalid ไม่รับมาใช้ ไม่เขียนทับ", async () => {
    t.fake.failNext(1);
    const bill = await save({ customer_id: s.custC });
    await t.tasks.idle();
    const key = receiptPdfKey({ branchCode: "00000", date: TODAY, docNo: bill.doc_no });
    const foreign = enc("%PDF-1.4\n% an older bill with the same number\n%%EOF\n");
    await rawPut(key, foreign, "application/pdf", { "receipt-id": NO_UUID, kind: "receipt" });

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(`/${bill.id}/pdf/retry`, "manager");
    const logged = log.mock.calls.flat().join(" ");
    log.mockRestore();
    expect(await res.json()).toMatchObject({ pdf_status: "invalid" });
    expect(logged).toContain("belongs to another bill");
    expect(await row(bill.id)).toMatchObject({ pdfStatus: "invalid", pdfKey: null, pdfSha256: null });
    expect(await stored(key)).toEqual(foreign);
    expect((await get(`/${bill.id}/pdf`, "staff")).status).toBe(409);
    // invalid ไม่เข้า retry อัตโนมัติ (ลองซ้ำก็ไม่หาย)
    expect(await t.pdf.retryDue({ olderThanMs: 0 })).toBe(0);
  });

  it("รูปบัตรหายจาก bucket → สำเนาบัตร invalid (loop ไม่แตะ) · ใส่รูปแล้ว manager กด retry → ready", async () => {
    const photoKey = "photos/d/missing.png";
    const [d] = await t.db
      .insert(customer)
      .values({ nationalId: "3100500987657", nameTh: "นางรูป หาย", cardExpireText: "31/12/2574", photoKey })
      .returning({ id: customer.id });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const bill = await save({ customer_id: d?.id });
    await t.tasks.idle();
    log.mockRestore();
    expect(await row(bill.id)).toMatchObject({ pdfStatus: "ready", idcardStatus: "invalid" });
    expect(await t.pdf.retryDue({ olderThanMs: 0 })).toBe(0);

    await t.storage.put(photoKey, PNG_1X1, "image/png");
    const res = await post(`/${bill.id}/pdf/retry`, "manager");
    expect(await res.json()).toEqual({ pdf_status: "ready", idcard_status: "ready", void_pdf_status: "none" });
  });

  it("ไฟล์ถูกแก้หลังบันทึก (sha256 ไม่ตรง) → ไม่ส่ง (500)", async () => {
    const bill = await save({ customer_id: s.custC });
    await t.tasks.idle();
    const { pdfKey } = await row(bill.id);
    t.storage.replace(pdfKey ?? "", {
      body: enc("%PDF-1.4\n% tampered\n%%EOF\n"),
      contentType: "application/pdf",
      metadata: { "receipt-id": bill.id },
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get(`/${bill.id}/pdf`, "staff")).status).toBe(500);
    log.mockRestore();
  });

  it("ยกเลิกบิล: manager/admin · reason บังคับ · สต็อกกลับ · audit · ไฟล์ _void ใหม่ ฉบับเดิมคงอยู่", async () => {
    const before = await row(billA.id);
    const original = await stored(before.pdfKey);

    expect((await post(`/${billA.id}/void`, "staff", { reason: "x" })).status).toBe(403);
    expect((await post(`/${billA.id}/void`, "acct", { reason: "x" })).status).toBe(403);
    expect((await post(`/${billA.id}/void`, "manager2", { reason: "x" })).status).toBe(404); // สาขาอื่น
    for (const body of [{}, { reason: "   " }, { reason: 5 }]) {
      const res = await post(`/${billA.id}/void`, "manager", body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ field: "reason" });
    }
    expect((await row(billA.id)).status).toBe("active");

    const res = await post(`/${billA.id}/void`, "manager", { reason: "  ลูกค้าขอคืนของ  " });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "void",
      void_reason: "ลูกค้าขอคืนของ",
      void_pdf_status: "pending",
      receipt: { status: "void", voidReason: "ลูกค้าขอคืนของ" },
    });
    expect(await row(billA.id)).toMatchObject({ status: "void", voidedBy: s.userIds.manager, voidedAt: NOW });

    // สต็อก: +5.860 ตอนซื้อ · −5.860 วันที่ยกเลิก — รวมเป็นศูนย์
    const moves = await t.db
      .select({ grams: stockMovement.grams, date: stockMovement.date })
      .from(stockMovement)
      .where(eq(stockMovement.sourceReceiptId, billA.id))
      .orderBy(asc(stockMovement.grams));
    expect(moves).toEqual([
      { grams: "-5.860", date: TODAY },
      { grams: "5.860", date: TODAY },
    ]);
    const [audit] = await audits("buy.void", billA.id);
    expect(audit).toMatchObject({ userId: s.userIds.manager });
    expect(audit?.diff).toMatchObject({ doc_no: "RC6910-0001", reason: "ลูกค้าขอคืนของ" });

    await t.tasks.idle();
    const after = await row(billA.id);
    expect(after).toMatchObject({
      voidPdfStatus: "ready",
      voidPdfKey: "receipts/00000/2026/10/RC6910-0001_void.pdf",
      voidPdfGeneratedAt: NOW,
      // ฉบับเดิมไม่ถูกแตะ
      pdfKey: before.pdfKey,
      pdfSha256: before.pdfSha256,
    });
    expect(after.voidPdfSha256).toBe(sha256Hex((await stored(after.voidPdfKey)) ?? new Uint8Array()));
    expect(await stored(before.pdfKey)).toEqual(original);
    const voidCall = t.fake.calls.find((c) => c.trace === "RC6910-0001-void");
    expect(voidCall?.html).toContain("ยกเลิก");
    expect(voidCall?.html).toContain("ลูกค้าขอคืนของ");

    // ค่าเริ่มต้นของบิลที่ยกเลิก = ฉบับยกเลิก · ?version=original = ฉบับเดิม
    const voided = await get(`/${billA.id}/pdf`, "staff");
    expect(voided.headers.get("content-disposition")).toBe('inline; filename="RC6910-0001_void.pdf"');
    expect(await bytes(voided)).toEqual(await stored(after.voidPdfKey));
    expect(await bytes(await get(`/${billA.id}/pdf?version=original`, "staff"))).toEqual(original);

    // S2: รายการและรายละเอียดบอกสถานะของฉบับยกเลิกที่ /pdf เสิร์ฟ
    const listed = (await (await get("", "staff")).json()) as {
      items: { id: string; status: string; void_pdf_status: string }[];
    };
    expect(listed.items.find((i) => i.id === billA.id)).toMatchObject({ status: "void", void_pdf_status: "ready" });
    expect(await (await get(`/${billA.id}`, "staff")).json()).toMatchObject({
      status: "void",
      idcard_status: "ready",
      void_pdf_status: "ready",
    });

    const again = await post(`/${billA.id}/void`, "manager", { reason: "ซ้ำ" });
    expect(again.status).toBe(409);
    expect(await audits("buy.void", billA.id)).toHaveLength(1);
  });

  it("receipt ใน GET /api/buy/:id = mapper เดียวกับ PDF ต่างแค่เลขบัตรมาสก์ · หัวใบจาก COMPANY_*", async () => {
    const bill = await save();
    await t.tasks.idle();
    const body = (await (await get(`/${bill.id}`, "staff")).json()) as { receipt: unknown };
    const src = await loadReceiptSource(t.db, bill.id);
    if (!src) throw new Error("no source");
    const pdfData = toReceiptData(src, companyFromEnv(t.env), { nationalId: "full" });
    expect(pdfData.customer.nationalId).toBe(ID_A);
    expect(body.receipt).toEqual({ ...pdfData, customer: { ...pdfData.customer, nationalId: maskNationalId(ID_A) } });
    expect(pdfData.company).toEqual({
      name: t.env.COMPANY_NAME,
      address: t.env.COMPANY_ADDRESS,
      tel: t.env.COMPANY_TEL,
      fax: null,
      taxId: t.env.COMPANY_TAX_ID,
    });
    // รหัสสาขาสรรพากรตามที่ตั้งไว้ ไม่เดาแทน
    const [hq] = await t.db.select().from(branch).where(eq(branch.code, "00000"));
    expect(pdfData.branch.taxBranchCode).toBe(hq?.taxBranchCode ?? null);
  });

  it("เลขบัตรเต็มไม่หลุดใน response ใด ๆ ของ /api/buy (R13)", async () => {
    const texts: string[] = [];
    const keep = async (res: Response | Promise<Response>) => texts.push(await (await res).text());
    await keep(
      t.request("/api/buy/quote", {
        cookie: s.cookies.staff,
        body: {
          customer_id: s.custA,
          // ทอง 96.5% 1 ก.: ⌊67650 × 0.0656 × 0.965⌋ = 4,282
          lines: [{ metal_id: s.metals.gold, weight_g: "1.000", purity_percent: "96.5" }],
          payments: [{ method: "cash", amount: "4282" }],
        },
      }),
    );
    const bill = await save();
    texts.push(JSON.stringify(bill));
    await t.tasks.idle();
    await keep(get("", "staff"));
    await keep(get(`/${bill.id}`, "staff"));
    await keep(get(`?q=${ID_A.slice(0, 6)}`, "staff"));
    t.fake.failNext(1);
    await keep(post(`/${bill.id}/void`, "manager", { reason: "ทดสอบ" }));
    await t.tasks.idle();
    await keep(post(`/${bill.id}/pdf/retry`, "manager"));
    expect(texts.length).toBeGreaterThanOrEqual(7);
    for (const text of texts) expect(text).not.toContain(ID_A);
  });

  it("หัวใบแช่แข็งตอนบันทึก (company_snapshot) — แก้ที่อยู่สาขาภายหลัง ฉบับยกเลิกยังพิมพ์หัวเดิม", async () => {
    const bill = await save({ customer_id: s.custC });
    await t.tasks.idle();
    const [hq] = await t.db.select().from(branch).where(eq(branch.code, "00000"));
    expect((await row(bill.id)).companySnapshot).toEqual({
      name: t.env.COMPANY_NAME,
      address: t.env.COMPANY_ADDRESS, // สาขายังไม่ตั้งที่อยู่ → ของกิจการ
      tel: t.env.COMPANY_TEL,
      fax: null,
      tax_id: t.env.COMPANY_TAX_ID,
      branch_name: hq?.name,
      branch_code: "00000",
      tax_branch_code: "00000",
    });

    const moved = "999 ถนนใหม่ หลังย้ายร้าน";
    await t.db.update(branch).set({ address: moved, tel: "076000000" }).where(eq(branch.code, "00000"));
    try {
      expect((await post(`/${bill.id}/void`, "manager", { reason: "ทดสอบหัวใบ" })).status).toBe(200);
      await t.tasks.idle();
      const voidCall = t.fake.calls.find((c) => c.trace === `${bill.doc_no}-void`);
      expect(voidCall?.html).toContain(t.env.COMPANY_ADDRESS);
      expect(voidCall?.html).not.toContain(moved);
      // บิลใหม่หลังแก้ใช้ที่อยู่/โทรของสาขา
      const fresh = await save({ customer_id: s.custC });
      await t.tasks.idle();
      expect((await row(fresh.id)).companySnapshot).toMatchObject({ address: moved, tel: "076000000" });
    } finally {
      await t.db.update(branch).set({ address: null, tel: null }).where(eq(branch.code, "00000"));
    }
  });

  it("บิลเก่าที่ snapshot ไม่มีรหัสสาขาสรรพากร → PDF invalid (ReceiptDataError) · loop ไม่ retry", async () => {
    // บิลใหม่ถูกกันตั้งแต่ตอนขาย (#53) — จำลองแถวเก่าด้วยการลบรหัสใน snapshot
    t.fake.failNext(1);
    const bill = await save({ customer_id: s.custC });
    await t.tasks.idle();
    await t.db
      .update(buyReceipt)
      .set({ companySnapshot: sql`jsonb_set(${buyReceipt.companySnapshot}, '{tax_branch_code}', 'null')` })
      .where(eq(buyReceipt.id, bill.id));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await t.pdf.archive(bill.id, { manual: true });
    const logged = log.mock.calls.flat().join(" ");
    log.mockRestore();
    expect(result).toMatchObject({ pdf_status: "invalid" });
    expect(logged).toContain(`${bill.doc_no} receipt invalid`);
    const res = await get(`/${bill.id}/pdf`, "staff");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ pdf_status: "invalid" });
    expect(await t.pdf.retryDue({ olderThanMs: 0 })).toBe(0);
  });

  it("ยกเลิกได้เฉพาะบิลของสาขาที่ทำงาน (อ่านได้แต่สาขาอื่น = 403 branch) · retry ได้ทุกบิลที่อ่านได้ (S5)", async () => {
    t.fake.failNext(1);
    const bill = await save({ customer_id: s.custC }, "staff2"); // สาขา 00002
    await t.tasks.idle();
    // admin เห็นทุกสาขาแต่กำลังทำงานที่ 00000
    const res = await post(`/${bill.id}/void`, "admin", { reason: "ทดสอบสาขา" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ field: "branch" });
    expect((await row(bill.id)).status).toBe("active");
    const retry = await post(`/${bill.id}/pdf/retry`, "admin");
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ pdf_status: "ready" });
    // manager ของ 00000 อ่านบิลสาขา 00002 ไม่ได้ = 404 (ไม่บอกว่ามี)
    expect((await post(`/${bill.id}/void`, "manager", { reason: "ทดสอบสาขา" })).status).toBe(404);
    expect((await post(`/${bill.id}/pdf/retry`, "manager")).status).toBe(404);
  });

  it("ยกเลิกบิลย้อนหลัง: กลับสต็อกลงวันที่ของบิล (ตรงกับรายงานยอดซื้อ) · ไฟล์ _void อยู่โฟลเดอร์เดือนของบิล (S1)", async () => {
    // ราคาของวันบิล (ทองแท่งรับซื้อ 66,800) ไม่ใช่ของวันนี้: ⌊66800 × 0.0656 × 0.965 = 4228.7072⌋ = 4,228/ก.
    // → ⌊4228 × 5.86 = 24,776.08⌋ = 24,776.00
    const bill = await save(
      {
        customer_id: s.custC,
        date: "2026-09-30",
        time: "16:30",
        backdate_reason: "คีย์ย้อนหลังจากใบเขียนมือ",
        payments: [{ method: "cash", amount: "24776" }],
      },
      "manager",
    );
    await t.tasks.idle();
    expect((await post(`/${bill.id}/void`, "manager", { reason: "ลูกค้าขอคืนของ" })).status).toBe(200);
    const moves = await t.db
      .select({ grams: stockMovement.grams, date: stockMovement.date })
      .from(stockMovement)
      .where(eq(stockMovement.sourceReceiptId, bill.id))
      .orderBy(asc(stockMovement.grams));
    expect(moves).toEqual([
      { grams: "-5.860", date: "2026-09-30" },
      { grams: "5.860", date: "2026-09-30" },
    ]);
    const [audit] = await audits("buy.void", bill.id);
    expect(audit?.diff).toMatchObject({ stock_reversed_on: "2026-09-30" });
    await t.tasks.idle();
    expect((await row(bill.id)).voidPdfKey).toBe(`receipts/00000/2026/09/${bill.doc_no}_void.pdf`);
  });

  it("S4: object ใน bucket ไม่ตรงกับที่เพิ่งเขียน (ผู้เขียนอื่นทับ) → invalid ไม่บันทึก sha ที่ไม่ใช่ไฟล์จริง", async () => {
    t.fake.failNext(1);
    const bill = await save({ customer_id: s.custC });
    await t.tasks.idle();
    const written = new Set<string>();
    const liar: Storage = {
      put: (k, b, c) => t.storage.put(k, b, c),
      get: (k) => t.storage.get(k),
      putImmutable: async (k, b, c, m) => {
        written.add(k);
        await t.storage.putImmutable(k, b, c, m);
      },
      exists: async (k) => {
        const head = await t.storage.exists(k);
        return head && written.has(k) ? { ...head, metadata: { ...head.metadata, sha256: "0".repeat(64) } } : head;
      },
    };
    const svc = createReceiptPdfService({
      db: t.db,
      storage: liar,
      renderer: t.fake.renderer,
      company: companyFromEnv(t.env),
      fonts: await loadPdfFonts(TEST_FONT_DIR),
      tasks: createManualTasks(),
      now: () => NOW,
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await svc.archive(bill.id, { manual: true });
    const logged = log.mock.calls.flat().join(" ");
    log.mockRestore();
    expect(result).toMatchObject({ pdf_status: "invalid" });
    expect(logged).toContain("changed right after upload");
    expect(await row(bill.id)).toMatchObject({ pdfStatus: "invalid", pdfKey: null, pdfSha256: null });
  });

  it("S4: รับไฟล์เดิมมาใช้เฉพาะเมื่อ byte ตรงกับ sha256 ใน metadata", async () => {
    t.fake.failNext(1);
    const bill = await save({ customer_id: s.custC });
    await t.tasks.idle();
    const key = receiptPdfKey({ branchCode: "00000", date: TODAY, docNo: bill.doc_no });
    await rawPut(key, enc("%PDF-1.4\n% bytes changed after upload\n%%EOF\n"), "application/pdf", {
      "receipt-id": bill.id,
      kind: "receipt",
      sha256: sha256Hex(enc("the bytes that were uploaded")),
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(`/${bill.id}/pdf/retry`, "manager");
    log.mockRestore();
    expect(await res.json()).toMatchObject({ pdf_status: "invalid" });
    expect(await row(bill.id)).toMatchObject({ pdfKey: null, pdfSha256: null });
  });

  it("ลายน้ำระบบทดสอบ (RECEIPT_WATERMARK) ลงทั้งใบรับซื้อและสำเนาบัตร", async () => {
    t.fake.failNext(2); // ใบ + สำเนาบัตรของบิลนี้ยังไม่มีไฟล์
    const bill = await save();
    await t.tasks.idle();
    const seen: HtmlToPdfInput[] = [];
    const recording: PdfRenderer = {
      htmlToPdf(input) {
        seen.push(input);
        return Promise.resolve(enc("%PDF-1.4\n% watermarked\n%%EOF\n"));
      },
      health: () => Promise.resolve({ up: true, status: 200 }),
    };
    const staging = createReceiptPdfService({
      db: t.db,
      storage: t.storage,
      renderer: recording,
      company: companyFromEnv(t.env),
      fonts: await loadPdfFonts(TEST_FONT_DIR),
      tasks: createManualTasks(),
      now: () => NOW,
      watermark: "ตัวอย่าง — ระบบทดสอบ ไม่ใช่ใบรับซื้อจริง",
    });
    expect(await staging.archive(bill.id, { manual: true })).toMatchObject({
      pdf_status: "ready",
      idcard_status: "ready",
    });
    expect(seen).toHaveLength(2);
    for (const input of seen) expect(input.html).toContain("ตัวอย่าง — ระบบทดสอบ ไม่ใช่ใบรับซื้อจริง");
  });

  /** แถวของบิลตามที่ GET /api/buy/:id ส่ง (ราคาที่ระบบคิดติดแถวไว้ตรวจย้อนหลัง) */
  interface DetailLine {
    line_no: number;
    metal: { code: string };
    weight_g: string;
    purity_percent: string | null;
    deduct_percent: string | null;
    base_price: string | null;
    unit_price: string | null;
    gross_amount: string | null;
    amount: string;
    price_per_g: string;
  }
  interface Detail {
    total_weight: string;
    total_amount: string;
    lines: DetailLine[];
    receipt: ReceiptData;
  }
  const detailOf = async (id: string) => {
    const res = await get(`/${id}`, "staff");
    expect(res.status).toBe(200);
    return (await res.json()) as Detail;
  };
  const lineCells = (l: DetailLine) => [
    l.line_no,
    l.metal.code,
    l.weight_g,
    l.purity_percent,
    l.deduct_percent,
    l.base_price,
    l.unit_price,
    l.gross_amount,
    l.amount,
    l.price_per_g,
  ];

  it("ใบรับซื้อพิมพ์ % ต่อรายการ: รวมแถวตาม (โลหะ · ค่าบริสุทธิ์ · หัก %) · หัก 0 ไม่พิมพ์ “หัก” · ยอดตรงสูตร", async () => {
    // ราคาตั้งต้น: ทองแท่งรับซื้อ 67,650 → ทอง 96.5% = ⌊67650 × 0.0656 × 0.965 = 4282.5156⌋ = 4,282/ก.
    //             เงิน 45.00/ก. (ราคากลาง) → เงิน 92.5% = ⌊45 × 0.925 = 41.625⌋ = 41/ก.
    // ทุกขั้นปัดลงเป็นบาทเต็ม: ยอดก่อนหัก = ⌊ราคา/ก. × กรัม⌋ · ยอดสุทธิ = ⌊ยอดก่อนหัก × (100 − หัก) ÷ 100⌋
    const lines = [
      // ⌊4282 × 10⌋ = 42,820 → ⌊42820 × 0.97 = 41535.4⌋ = 41,535 (หัก 1,285)
      { metal_id: s.metals.gold, weight_g: "10", purity_percent: "96.5", deduct_percent: "3" },
      // ⌊4282 × 5.86 = 25092.52⌋ = 25,092 · ไม่ส่งหัก % = 0
      { metal_id: s.metals.gold, weight_g: "5.860", purity_percent: "96.5" },
      // ⌊4282 × 2⌋ = 8,564 → ⌊8564 × 0.97 = 8307.08⌋ = 8,307 (หัก 257) — กลุ่มเดียวกับแถวแรก
      { metal_id: s.metals.gold, weight_g: "2", purity_percent: "96.5", deduct_percent: "3" },
      // ⌊41 × 271.56 = 11133.96⌋ = 11,133 · หัก null = 0
      { metal_id: s.metals.silver, weight_g: "271.56", purity_percent: "92.5", deduct_percent: null },
      // "96.50" กับหัก "0" = กลุ่มเดียวกับแถวที่สอง (รูปมาตรฐานเดียวกัน) · ⌊4282 × 1⌋ = 4,282
      { metal_id: s.metals.gold, weight_g: "1.000", purity_percent: "96.50", deduct_percent: "0" },
    ];
    // Σ = 41,535 + 25,092 + 8,307 + 11,133 + 4,282 = 90,349.00 · Σกรัม = 10 + 5.86 + 2 + 271.56 + 1 = 290.420
    const payments = [{ method: "cash", amount: "90349" }];

    const quote = await t.request("/api/buy/quote", {
      cookie: s.cookies.staff,
      body: { customer_id: s.custC, lines, payments },
    });
    expect(quote.status).toBe(200);
    const g = s.metals.gold;
    const ag = s.metals.silver;
    expect(await quote.json()).toMatchObject({
      ok: true,
      errors: [],
      lines: [
        {
          index: 0,
          metal_id: g,
          weight_g: "10.000",
          purity_percent: "96.50",
          deduct_percent: "3",
          base_price: "67650.00",
          unit_price: "4282.00",
          gross_amount: "42820.00",
          deduct_amount: "1285.00",
          amount: "41535.00",
          price_per_g: "4153.50",
        },
        {
          index: 1,
          metal_id: g,
          weight_g: "5.860",
          purity_percent: "96.50",
          deduct_percent: "0",
          base_price: "67650.00",
          unit_price: "4282.00",
          gross_amount: "25092.00",
          deduct_amount: "0.00",
          amount: "25092.00",
          price_per_g: "4281.91",
        },
        {
          index: 2,
          metal_id: g,
          weight_g: "2.000",
          purity_percent: "96.50",
          deduct_percent: "3",
          base_price: "67650.00",
          unit_price: "4282.00",
          gross_amount: "8564.00",
          deduct_amount: "257.00",
          amount: "8307.00",
          price_per_g: "4153.50",
        },
        {
          index: 3,
          metal_id: ag,
          weight_g: "271.560",
          purity_percent: "92.50",
          deduct_percent: "0",
          base_price: "45.00",
          unit_price: "41.00",
          gross_amount: "11133.00",
          deduct_amount: "0.00",
          amount: "11133.00",
          // 11,133 ÷ 271.56 = 40.99646… → 41.00
          price_per_g: "41.00",
        },
        {
          index: 4,
          metal_id: g,
          weight_g: "1.000",
          purity_percent: "96.50",
          deduct_percent: "0",
          base_price: "67650.00",
          unit_price: "4282.00",
          gross_amount: "4282.00",
          deduct_amount: "0.00",
          amount: "4282.00",
          price_per_g: "4282.00",
        },
      ],
      total_weight: "290.420",
      total_amount: "90349.00",
      // 90,349 ÷ 290.42 = 311.0977… → 311.10
      avg_price_per_g: "311.10",
      paid: "90349.00",
      balance: "0.00",
    });

    const bill = await save({ customer_id: s.custC, lines, payments });
    await t.tasks.idle();
    expect(await row(bill.id)).toMatchObject({ pdfStatus: "ready", totalAmount: "90349.00", totalWeight: "290.420" });

    // ใบที่เก็บถาวร: 1 บรรทัดต่อ (โลหะ · บริสุทธิ์ · หัก %) ตามลำดับที่ปรากฏ · ราคาต่อหน่วย = Σราคา ÷ Σกรัม ปัดครึ่งขึ้น 2 ตำแหน่ง
    const expectedRows = [
      // 10 + 2 = 12.000 ก. · 41,535 + 8,307 = 49,842.00 · 49,842 ÷ 12 = 4,153.50
      ["ทอง 96.5% หัก 3%", "12.000", "กรัม", "4,153.50", "49,842.00"],
      // 5.86 + 1 = 6.860 ก. · 25,092 + 4,282 = 29,374.00 · 29,374 ÷ 6.86 = 4,281.924… → 4,281.92
      ["ทอง 96.5%", "6.860", "กรัม", "4,281.92", "29,374.00"],
      ["เงิน 92.5%", "271.560", "กรัม", "41.00", "11,133.00"],
    ];
    const html = t.fake.calls.find((c) => c.trace === bill.doc_no)?.html;
    expect(itemRows(html)).toEqual(expectedRows);
    expect(html).toContain("เก้าหมื่นสามร้อยสี่สิบเก้าบาทถ้วน"); // 90,349.00
    expect(html).not.toContain("หัก 0%");

    // GET /api/buy/:id: ราคาที่ระบบคิดติดแถวไว้ (รูปเดียวกับ quote)
    const detail = await detailOf(bill.id);
    expect(detail).toMatchObject({ total_weight: "290.420", total_amount: "90349.00" });
    expect(detail.lines.map(lineCells)).toEqual([
      [1, "gold", "10.000", "96.50", "3", "67650.00", "4282.00", "42820.00", "41535.00", "4153.50"],
      [2, "gold", "5.860", "96.50", "0", "67650.00", "4282.00", "25092.00", "25092.00", "4281.91"],
      [3, "gold", "2.000", "96.50", "3", "67650.00", "4282.00", "8564.00", "8307.00", "4153.50"],
      [4, "silver", "271.560", "92.50", "0", "45.00", "41.00", "11133.00", "11133.00", "41.00"],
      [5, "gold", "1.000", "96.50", "0", "67650.00", "4282.00", "4282.00", "4282.00", "4282.00"],
    ]);
    // ใบบนจอ (receipt ของ GET) ได้ % ของทุกแถวไปพิมพ์เอง แล้วพิมพ์แถวเดียวกับ PDF ทุกตัวอักษร
    // % เทียบแบบตัดศูนย์ท้าย — ใบได้ค่าตามสเกลของคอลัมน์ (numeric(6,3) / (5,2)) จึงไม่ผูกกับจำนวนศูนย์
    const pct = (v: string | null | undefined) => v?.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") ?? null;
    expect(
      detail.receipt.lines.map((l) => [l.metalName, l.weightG, l.amount, pct(l.purityPercent), pct(l.deductPercent)]),
    ).toEqual([
      ["ทอง", "10.000", "41535.00", "96.5", "3"],
      ["ทอง", "5.860", "25092.00", "96.5", "0"],
      ["ทอง", "2.000", "8307.00", "96.5", "3"],
      ["เงิน", "271.560", "11133.00", "92.5", "0"],
      ["ทอง", "1.000", "4282.00", "96.5", "0"],
    ]);
    expect(itemRows(renderReceiptHtml(detail.receipt))).toEqual(expectedRows);
  });

  it("บิลก่อนมีค่าบริสุทธิ์ (purity/deduct เป็น null) พิมพ์ชื่อโลหะอย่างเดียว · รวมตามโลหะเหมือนเดิม", async () => {
    t.fake.failNext(1); // ยังไม่มีไฟล์ — จะพิมพ์หลังทำแถวให้เป็นแบบเก่า
    // ⌊4282 × 5.86⌋ = 25,092 · ทอง 90%: ⌊67650 × 0.0656 × 0.9 = 3994.056⌋ = 3,994/ก. × 1 = 3,994 · รวม 29,086.00
    const bill = await save({
      customer_id: s.custC,
      lines: [
        { metal_id: s.metals.gold, weight_g: "5.860", purity_percent: "96.5" },
        { metal_id: s.metals.gold, weight_g: "1.000", purity_percent: "90" },
      ],
      payments: [{ method: "cash", amount: "29086" }],
    });
    await t.tasks.idle();
    expect((await row(bill.id)).pdfStatus).toBe("failed");
    // แถวที่บันทึกก่อน UAT 30 ก.ย. 2569: ราคาพิมพ์เอง ไม่มีค่าบริสุทธิ์/หัก %/ราคาที่ระบบคิด
    await t.db
      .update(buyLine)
      .set({
        purityPercent: null,
        deductPercent: null,
        basePrice: null,
        assessedPricePerG: null,
        assessmentAmount: null,
      })
      .where(eq(buyLine.receiptId, bill.id));

    expect(await t.pdf.archive(bill.id, { manual: true })).toMatchObject({ pdf_status: "ready" });
    const html = t.fake.calls.filter((c) => c.trace === bill.doc_no).at(-1)?.html;
    // 5.86 + 1 = 6.860 ก. · 29,086 ÷ 6.86 = 4,239.941… → 4,239.94 — แถวเดียวแบบใบจริง RC6909-0010
    expect(itemRows(html)).toEqual([["ทอง", "6.860", "กรัม", "4,239.94", "29,086.00"]]);
    expect(html).toContain("สองหมื่นเก้าพันแปดสิบหกบาทถ้วน");
    expect(html).not.toContain("%</td>");

    const detail = await detailOf(bill.id);
    expect(detail.lines.map(lineCells)).toEqual([
      [1, "gold", "5.860", null, null, null, null, null, "25092.00", "4281.91"],
      [2, "gold", "1.000", null, null, null, null, null, "3994.00", "3994.00"],
    ]);
    expect(detail.receipt.lines.map((l) => [l.metalName, l.purityPercent, l.deductPercent])).toEqual([
      ["ทอง", null, null],
      ["ทอง", null, null],
    ]);
    expect(itemRows(renderReceiptHtml(detail.receipt))).toEqual([["ทอง", "6.860", "กรัม", "4,239.94", "29,086.00"]]);
  });

  it("ไฟล์ที่เก็บไม่เคยถูกเขียนซ้ำ (ทุก key ถูก PUT ครั้งเดียว)", () => {
    const pdfPuts = puts.filter((k) => k.startsWith("receipts/") || k.startsWith("idcards/"));
    expect(pdfPuts.length).toBeGreaterThan(5);
    expect(new Set(pdfPuts).size).toBe(pdfPuts.length);
  });
});

// ---------- Gotenberg จริง (ข้ามเมื่อไม่มี · CI บังคับผ่าน TEST_GOTENBERG_URL) ----------

const gotenberg = available && (await gotenbergAvailable());

describe.skipIf(!gotenberg)("PDF จริงผ่าน Gotenberg — บันทึกบิล → ใบรับซื้อ + สำเนาบัตรภาษาไทย", () => {
  let t: TestApp;
  let s: Awaited<ReturnType<typeof seed>>;
  /** HTML ที่ส่งเข้า Gotenberg จริง (renderer จริงห่อด้วยตัวจด) — api ไม่มีตัวดึงข้อความจาก PDF · ข้อความใน PDF ตรวจใน e2e */
  const sent: HtmlToPdfInput[] = [];

  beforeAll(async () => {
    const real = createGotenbergClient(TEST_GOTENBERG);
    const recording: PdfRenderer = {
      htmlToPdf(input) {
        sent.push(input);
        return real.htmlToPdf(input);
      },
      health: () => real.health(),
    };
    t = await startTestApp({ now: () => NOW, pdfTasks: "auto", renderer: recording });
    s = await seed(t);
  });
  afterAll(async () => {
    await t?.close();
  });

  it("ได้ PDF ที่ฝัง Sarabun ทั้งใบรับซื้อ ฉบับยกเลิก และสำเนาบัตร", async () => {
    const res = await t.request("/api/buy", {
      cookie: s.cookies.staff,
      body: {
        idempotency_key: "real-gotenberg-key-000001",
        customer_id: s.custA,
        lines: [
          // ⌊67650 × 0.0656 × 0.965⌋ = 4,282/ก. → ⌊4282 × 5.86⌋ = 25,092 → หัก 3%: ⌊25092 × 0.97 = 24339.24⌋ = 24,339
          { metal_id: s.metals.gold, weight_g: "5.860", purity_percent: "96.5", deduct_percent: "3" },
          // เงิน 45.00/ก. × 92.5% = ⌊41.625⌋ = 41/ก. → ⌊41 × 271.56 = 11133.96⌋ = 11,133
          { metal_id: s.metals.silver, weight_g: "271.560", purity_percent: "92.5" },
        ],
        payments: [{ method: "cash", amount: "35472" }], // 24,339 + 11,133
      },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const { id, doc_no } = (await res.json()) as Saved;
    await t.tasks.idle();
    const html = sent.find((c) => c.trace === doc_no)?.html;
    // 24,339 ÷ 5.86 = 4,153.412… → 4,153.41 · 11,133 ÷ 271.56 = 40.996… → 41.00
    expect(itemRows(html)).toEqual([
      ["ทอง 96.5% หัก 3%", "5.860", "กรัม", "4,153.41", "24,339.00"],
      ["เงิน 92.5%", "271.560", "กรัม", "41.00", "11,133.00"],
    ]);
    expect(html).toContain("สามหมื่นห้าพันสี่ร้อยเจ็ดสิบสองบาทถ้วน"); // 35,472.00

    const receipt = await t.request(`/api/buy/${id}/pdf`, { cookie: s.cookies.staff });
    expect(receipt.status).toBe(200);
    const pdf = Buffer.from(await receipt.arrayBuffer()).toString("latin1");
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+Sarabun-(Regular|Bold)/);

    const idcard = await t.request(`/api/buy/${id}/idcard`, { cookie: s.cookies.acct });
    expect(idcard.status).toBe(200);
    expect(
      Buffer.from(await idcard.arrayBuffer())
        .toString("latin1")
        .startsWith("%PDF-"),
    ).toBe(true);

    expect(
      (await t.request(`/api/buy/${id}/void`, { cookie: s.cookies.manager, body: { reason: "ทดสอบ" } })).status,
    ).toBe(200);
    await t.tasks.idle();
    const voided = await t.request(`/api/buy/${id}/pdf`, { cookie: s.cookies.staff });
    expect(voided.status).toBe(200);
    expect(voided.headers.get("content-disposition")).toContain("_void.pdf");
  });
});

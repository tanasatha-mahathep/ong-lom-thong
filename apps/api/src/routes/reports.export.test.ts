import { D, ZERO, fmtMoney, fmtWeight, pricePerGram } from "@ong/core";
import { auditLog, branch, buyLine, buyReceipt, customer, metal, payment } from "@ong/db";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../lib/pdfArchive";
import type { Storage } from "../lib/storage";
import { ExportTimeoutError, exportPeriod, prepareMonthlyExport, streamMonthlyExport } from "../services/monthlyExport";
import { type TestApp, databaseAvailable, startTestApp } from "../test/harness";
import { readAll, readZip } from "../test/unzip";

const available = await databaseAvailable();
const PW = "correct-horse-battery";
const NO_BRANCH = "00000000-0000-4000-8000-000000000000";

// เลขบัตรสมมติที่ checksum ถูก — ห้ามใช้ข้อมูลลูกค้าจริง (CLAUDE.md กฎ 8)
const ID_A = "1103700123458";
const ID_B = "3100500987657";
const ID_C = "5109900112237";
const NAMES = { A: "นายทดสอบ ส่งบัญชี", B: "นางสาวบี ทดสอบ", C: "นายซี ทดสอบ" } as const;

// 10:00 น. วันที่ 5 พ.ย. 2569 เวลาไทย — ต.ค. เป็นเดือนที่ปิดแล้ว · พ.ย. = เดือนปัจจุบัน
const NOW = new Date("2026-11-05T03:00:00Z");
const HQ = "สำนักงานใหญ่ (สาขา 1)";
const OCT = "year=2026&month=10";

interface ManifestFile {
  path: string | null;
  sha256: string | null;
  status: string;
}
interface Manifest {
  manifest_version: number;
  year: number;
  month: number;
  generated_for: { branches: { id: string; code: string; name: string }[] };
  purchase_report: { path: string; sha256: string };
  bills: {
    doc_no: string;
    date: string;
    branch_code: string;
    status: string;
    total_amount: string;
    pdf: ManifestFile;
    void_pdf: ManifestFile | null;
  }[];
  counts: Record<string, number>;
  totals: { total_weight: string; total_amount: string; void_total_amount: string };
}

type Line = [metal: string, weight: string, amount: string];
type PdfState = "ready" | "pending" | "failed" | "invalid" | "tampered" | "gone";
interface BillSpec {
  code: string;
  date: string;
  docNo: string;
  cust: "A" | "B" | "C";
  lines: Line[];
  pdf: PdfState;
  /** ยกเลิกแล้ว — ฉบับยกเลิก ready หรือยัง pending */
  voided?: "ready" | "pending";
}

describe.skipIf(!available)("ส่งบัญชีรายเดือน (spec §9.4) — GET /api/reports/export", () => {
  let t: TestApp;
  let clock = NOW;
  const cookies: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  const bills: Record<string, string> = {};
  let metals: Record<string, string> = {};
  let keySeq = 0;
  let rawGet: Storage["get"];
  const realError = console.error.bind(console);
  const realWarn = console.warn.bind(console);
  /** log ของ export ที่คาดไว้ (sha ไม่ตรง · ไฟล์หาย) — เก็บไว้ตรวจ ไม่พิมพ์รก */
  const exportLogs: string[] = [];

  const ref = (code: string) => ({
    id: t.branches[code] ?? "",
    code,
    name: code === "00000" ? HQ : code === "00001" ? "สาขา 2" : "สาขา 3",
  });

  /** บิลแบบที่ POST /buy บันทึก (หัวบิล + แถว + ชำระ) แล้วทำ PDF ให้อยู่ในสถานะที่ต้องการผ่าน pipeline จริง */
  async function addBill(s: BillSpec): Promise<string> {
    const weight = s.lines.reduce((sum, [, w]) => sum.plus(D(w)), ZERO);
    const amount = s.lines.reduce((sum, [, , a]) => sum.plus(D(a)), ZERO);
    const nationalId = { A: ID_A, B: ID_B, C: ID_C }[s.cust];
    const id = await t.db.transaction(async (tx) => {
      const [c] = await tx.select().from(customer).where(eq(customer.nationalId, nationalId));
      if (!c) throw new Error("fixture customer missing");
      const [r] = await tx
        .insert(buyReceipt)
        .values({
          branchId: t.branches[s.code] ?? "",
          docNo: s.docNo,
          date: s.date,
          time: "10:00",
          customerId: c.id,
          customerSnapshot: {
            national_id: c.nationalId,
            name_th: c.nameTh,
            name_en: null,
            birthday_text: null,
            religion: null,
            address: "1 ถ.ทดสอบ ต.ในเมือง อ.เมือง จ.ขอนแก่น",
            card_issue_text: null,
            card_expire_text: c.cardExpireText,
            mobile: null,
            phone2: null,
            photo_key: null,
          },
          goldPriceSnapshot: "67850",
          totalWeight: fmtWeight(weight),
          totalAmount: fmtMoney(amount),
          createdBy: userIds.staff0 ?? "",
          idempotencyKey: `export-fixture-${String(++keySeq).padStart(6, "0")}`,
        })
        .returning({ id: buyReceipt.id });
      if (!r) throw new Error("insert failed");
      await tx.insert(buyLine).values(
        s.lines.map(([m, w, a], i) => ({
          receiptId: r.id,
          lineNo: i + 1,
          metalId: metals[m] ?? "",
          weightG: w,
          amount: a,
          pricePerG: fmtMoney(pricePerGram(D(a), D(w))),
        })),
      );
      await tx.insert(payment).values({ receiptId: r.id, method: "cash", amount: fmtMoney(amount) });
      return r.id;
    });

    if (s.pdf === "failed" || s.pdf === "invalid") {
      await t.db.update(buyReceipt).set({ pdfStatus: s.pdf }).where(eq(buyReceipt.id, id));
    } else if (s.pdf !== "pending") {
      expect((await t.pdf.archive(id))?.pdf_status).toBe("ready");
    }
    if (s.voided) {
      await t.db
        .update(buyReceipt)
        .set({
          status: "void",
          voidedBy: userIds.admin,
          voidedAt: NOW,
          voidReason: "ทดสอบยกเลิก",
          voidPdfStatus: "pending",
        })
        .where(eq(buyReceipt.id, id));
      if (s.voided === "ready") expect((await t.pdf.archive(id))?.void_pdf_status).toBe("ready");
    }
    const row = await receipt(id);
    if (s.pdf === "tampered" && row.pdfKey) {
      // ไฟล์ใน bucket ถูกแก้หลังบันทึก sha256 — export ต้องไม่ใส่ไฟล์นี้
      const stored = await t.storage.get(row.pdfKey);
      if (!stored) throw new Error("fixture pdf missing");
      t.storage.replace(row.pdfKey, { ...stored, body: new TextEncoder().encode("%PDF-1.4\n% TAMPERED\n%%EOF\n") });
    }
    if (s.pdf === "gone") {
      // DB ว่าพร้อม แต่ไม่มีไฟล์ที่ key นั้นใน bucket
      await t.db
        .update(buyReceipt)
        .set({ pdfKey: `receipts/${s.code}/2026/10/RC6910-9999.pdf` })
        .where(eq(buyReceipt.id, id));
    }
    return id;
  }

  async function receipt(id: string) {
    const [r] = await t.db.select().from(buyReceipt).where(eq(buyReceipt.id, id));
    if (!r) throw new Error(`no receipt ${id}`);
    return r;
  }

  beforeAll(async () => {
    t = await startTestApp({ now: () => clock });
    rawGet = t.storage.get.bind(t.storage);
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].startsWith("[export]")) exportLogs.push(args[0]);
      else realError(...args);
    });
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].startsWith("[export]")) exportLogs.push(args[0]);
      else realWarn(...args);
    });
    const accounts = [
      { who: "staff0", branch: "00000" },
      { who: "mgr0", role: "manager" as const, branch: "00000" },
      { who: "acct", role: "accounting" as const, branch: "00000", viewAll: true },
      { who: "acct2", role: "accounting" as const, branch: "00002" }, // บัญชีที่ดูแลเฉพาะสาขา 00002
      { who: "admin", role: "admin" as const, viewAll: true },
      { who: "nobranch", role: "accounting" as const },
    ];
    for (const a of accounts) {
      const created = await t.createUser({ email: `${a.who}@ong.test`, password: PW, ...a });
      userIds[a.who] = created.id;
      cookies[a.who] = await t.login(`${a.who}@ong.test`, PW);
    }
    metals = Object.fromEntries((await t.db.select().from(metal)).map((m) => [m.code, m.id]));
    // ออก PDF ได้เฉพาะสาขาที่ตั้งรหัสสาขาสรรพากรแล้ว — seed ตั้งให้สำนักงานใหญ่เท่านั้น
    for (const code of ["00001", "00002"]) {
      await t.db.update(branch).set({ taxBranchCode: code }).where(eq(branch.code, code));
    }
    await t.db.insert(customer).values([
      { nationalId: ID_A, nameTh: NAMES.A, cardExpireText: "31/12/2574" },
      { nationalId: ID_B, nameTh: NAMES.B, cardExpireText: "31/12/2574" },
      { nationalId: ID_C, nameTh: NAMES.C, cardExpireText: "31/12/2574" },
    ]);

    const specs: Record<string, BillSpec> = {
      // 00000 — ต.ค.: ปกติ · ยกเลิก (ฉบับเดิม + ฉบับยกเลิก) · PDF ยังไม่เสร็จ · วันสุดท้ายของเดือน
      b1: {
        code: "00000",
        date: "2026-10-01",
        docNo: "RC6910-0001",
        cust: "A",
        lines: [["gold", "5.860", "20030.00"]],
        pdf: "ready",
      },
      b2: {
        code: "00000",
        date: "2026-10-15",
        docNo: "RC6910-0002",
        cust: "B",
        lines: [
          ["gold", "10.000", "30000.00"],
          ["silver", "100.000", "1500.00"],
        ],
        pdf: "ready",
        voided: "ready",
      },
      b3: {
        code: "00000",
        date: "2026-10-20",
        docNo: "RC6910-0003",
        cust: "A",
        lines: [["silver", "50.500", "800.50"]],
        pdf: "pending",
      },
      b4: {
        code: "00000",
        date: "2026-10-31",
        docNo: "RC6910-0004",
        cust: "C",
        lines: [["gold", "1.000", "3000.00"]],
        pdf: "ready",
      },
      // ขอบเดือน: 30 ก.ย. · 1 พ.ย. ไม่อยู่ใน ต.ค.
      b5: {
        code: "00000",
        date: "2026-09-30",
        docNo: "RC6909-0001",
        cust: "A",
        lines: [["gold", "2.000", "6000.00"]],
        pdf: "ready",
      },
      b6: {
        code: "00000",
        date: "2026-11-01",
        docNo: "RC6911-0001",
        cust: "B",
        lines: [["gold", "3.000", "9000.00"]],
        pdf: "ready",
      },
      // 00001 — เลขที่ซ้ำกับสาขาอื่นได้ · สถานะไฟล์ที่ไม่พร้อมทุกแบบ
      b7: {
        code: "00001",
        date: "2026-10-01",
        docNo: "RC6910-0001",
        cust: "C",
        lines: [["nak", "3.250", "5000.00"]],
        pdf: "ready",
      },
      b8: {
        code: "00001",
        date: "2026-10-05",
        docNo: "RC6910-0002",
        cust: "B",
        lines: [["platinum", "2.000", "2400.00"]],
        pdf: "ready",
        voided: "pending",
      },
      b9: {
        code: "00001",
        date: "2026-10-06",
        docNo: "RC6910-0003",
        cust: "A",
        lines: [["gold", "0.500", "1500.25"]],
        pdf: "failed",
      },
      b10: {
        code: "00001",
        date: "2026-10-07",
        docNo: "RC6910-0004",
        cust: "A",
        lines: [["gold", "1.234", "4000.00"]],
        pdf: "tampered",
      },
      b11: {
        code: "00001",
        date: "2026-10-08",
        docNo: "RC6910-0005",
        cust: "B",
        lines: [["silver", "10.000", "150.00"]],
        pdf: "invalid",
      },
      b12: {
        code: "00001",
        date: "2026-10-09",
        docNo: "RC6910-0006",
        cust: "C",
        lines: [["gold", "0.100", "300.00"]],
        pdf: "gone",
      },
      // 00002
      b13: {
        code: "00002",
        date: "2026-10-10",
        docNo: "RC6910-0001",
        cust: "A",
        lines: [["gold", "7.777", "25555.55"]],
        pdf: "ready",
      },
    };
    for (const [key, spec] of Object.entries(specs)) bills[key] = await addBill(spec);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await t?.close();
  });

  const request = (qs: string, who?: string, method = "GET") =>
    t.request(`/api/reports/export?${qs}`, { method, cookie: who ? cookies[who] : undefined });

  async function download(qs: string, who = "acct") {
    const res = await request(qs, who);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const entries = readZip(bytes);
    const entry = (name: string) => entries.find((e) => e.name === name)?.data ?? new Uint8Array();
    const text = (name: string) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(entry(name));
    return {
      res,
      bytes,
      entries,
      names: entries.map((e) => e.name),
      entry,
      manifest: JSON.parse(text("manifest.json")) as Manifest,
      csv: entry("purchase-report.csv"),
      readme: text("README.txt"),
    };
  }
  /** CSV จาก endpoint รายงานยอดซื้อ ของเดือน ต.ค. — byte จริง (Response.text() ตัด BOM) */
  async function reportCsv(who: string, branchId?: string) {
    const qs = `date_from=2026-10-01&date_to=2026-10-31&format=csv${branchId ? `&branch_id=${branchId}` : ""}`;
    const res = await t.request(`/api/reports/purchase?${qs}`, { cookie: cookies[who] });
    expect(res.status).toBe(200);
    return new Uint8Array(await res.arrayBuffer());
  }
  const exportAudits = () =>
    t.db.select().from(auditLog).where(eq(auditLog.action, "export.monthly")).orderBy(asc(auditLog.id));
  const receiptsIn = (names: string[]) => names.filter((n) => n.startsWith("receipts/"));

  it("ต้อง login · staff/manager = 403 · บัญชีที่ไม่มีสาขา = 403 · ไม่ลง audit", async () => {
    const before = (await exportAudits()).length;
    expect((await request(OCT)).status).toBe(401);
    for (const who of ["staff0", "mgr0", "nobranch"]) expect((await request(OCT, who)).status).toBe(403);
    expect((await exportAudits()).length).toBe(before);
    for (const who of ["acct", "admin"]) await download(OCT, who);
  });

  it("header: zip แนบไฟล์ · no-store · nosniff · ชื่อไฟล์มีงวด (+ รหัสสาขาเมื่อเลือกสาขา)", async () => {
    const all = await download(OCT);
    expect(all.res.headers.get("content-type")).toBe("application/zip");
    expect(all.res.headers.get("content-disposition")).toBe('attachment; filename="ong-export-2026-10.zip"');
    expect(all.res.headers.get("cache-control")).toBe("no-store");
    expect(all.res.headers.get("x-content-type-options")).toBe("nosniff");
    const one = await download(`year=2026&month=9&branch_id=${t.branches["00001"]}`);
    expect(one.res.headers.get("content-disposition")).toBe('attachment; filename="ong-export-2026-09-00001.zip"');
  });

  it("โครง zip: README → CSV → PDF เรียงตาม path → manifest ท้ายสุด · STORE · เวลา 1 ต.ค. 00:00 · 0644 · byte = ไฟล์ใน bucket", async () => {
    const z = await download(OCT);
    expect(z.names).toEqual([
      "README.txt",
      "purchase-report.csv",
      "receipts/00000/RC6910-0001.pdf",
      "receipts/00000/RC6910-0002.pdf",
      "receipts/00000/RC6910-0002_void.pdf",
      "receipts/00000/RC6910-0004.pdf",
      "receipts/00001/RC6910-0001.pdf",
      "receipts/00001/RC6910-0002.pdf",
      "receipts/00002/RC6910-0001.pdf",
      "manifest.json",
    ]);
    for (const e of z.entries) {
      expect([e.method, e.modified, e.mode]).toEqual([0, "2026-10-01 00:00:00", 0o100644]);
    }
    // ทุก PDF ใน zip = ไฟล์ที่เก็บถาวร (byte ตรง · sha256 ตรงกับ DB)
    for (const [key, name] of [
      ["b1", "receipts/00000/RC6910-0001.pdf"],
      ["b4", "receipts/00000/RC6910-0004.pdf"],
      ["b7", "receipts/00001/RC6910-0001.pdf"],
      ["b13", "receipts/00002/RC6910-0001.pdf"],
    ] as const) {
      const r = await receipt(bills[key] ?? "");
      expect(z.entry(name)).toEqual((await rawGet(r.pdfKey ?? ""))?.body);
      expect(sha256Hex(z.entry(name))).toBe(r.pdfSha256);
    }
    // README ภาษาไทย (UTF-8 + BOM + CRLF) อธิบายไฟล์และวิธีตรวจ sha256
    expect([...z.entry("README.txt").slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(z.readme).toContain("\r\n");
    for (const s of ["manifest.json", "purchase-report.csv", "_void.pdf", "sha256", "Get-FileHash", "shasum -a 256"]) {
      expect(z.readme).toContain(s);
    }
    expect(z.readme).toContain("สำเนาบัตรประชาชนไม่อยู่ในไฟล์นี้");
    expect(z.readme).toContain("1 ตุลาคม 2569 ถึง 31 ตุลาคม 2569");
  });

  it("purchase-report.csv = CSV ของ /reports/purchase เดือนเดียวกัน ขอบเขตเดียวกัน (ทุก byte รวม BOM)", async () => {
    const all = await download(OCT);
    expect(all.csv).toEqual(await reportCsv("acct"));
    expect([...all.csv.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const one = await download(`${OCT}&branch_id=${t.branches["00001"]}`, "admin");
    expect(one.csv).toEqual(await reportCsv("admin", t.branches["00001"]));
    const own = await download(OCT, "acct2");
    expect(own.csv).toEqual(await reportCsv("acct2"));
    expect(all.manifest.purchase_report).toEqual({ path: "purchase-report.csv", sha256: sha256Hex(all.csv) });
  });

  it("manifest ของสาขา 00000: ทุกบิลของเดือน · sha256 จาก DB · ไฟล์ที่ไม่พร้อมมีสถานะ ไม่มี path · counts · totals", async () => {
    const z = await download(`${OCT}&branch_id=${t.branches["00000"]}`);
    const [b1, b2, b4] = await Promise.all([receipt(bills.b1 ?? ""), receipt(bills.b2 ?? ""), receipt(bills.b4 ?? "")]);
    expect(z.manifest).toEqual({
      manifest_version: 1,
      year: 2026,
      month: 10,
      generated_for: { branches: [ref("00000")] },
      purchase_report: { path: "purchase-report.csv", sha256: sha256Hex(z.csv) },
      bills: [
        {
          doc_no: "RC6910-0001",
          date: "2026-10-01",
          branch_code: "00000",
          status: "active",
          total_amount: "20030.00",
          pdf: { path: "receipts/00000/RC6910-0001.pdf", sha256: b1.pdfSha256, status: "ready" },
          void_pdf: null,
        },
        {
          doc_no: "RC6910-0002",
          date: "2026-10-15",
          branch_code: "00000",
          status: "void",
          total_amount: "31500.00",
          pdf: { path: "receipts/00000/RC6910-0002.pdf", sha256: b2.pdfSha256, status: "ready" },
          void_pdf: { path: "receipts/00000/RC6910-0002_void.pdf", sha256: b2.voidPdfSha256, status: "ready" },
        },
        {
          doc_no: "RC6910-0003",
          date: "2026-10-20",
          branch_code: "00000",
          status: "active",
          total_amount: "800.50",
          pdf: { path: null, sha256: null, status: "pending" },
          void_pdf: null,
        },
        {
          doc_no: "RC6910-0004",
          date: "2026-10-31",
          branch_code: "00000",
          status: "active",
          total_amount: "3000.00",
          pdf: { path: "receipts/00000/RC6910-0004.pdf", sha256: b4.pdfSha256, status: "ready" },
          void_pdf: null,
        },
      ],
      counts: { bills: 4, active: 3, void: 1, pdf_expected: 5, pdf_included: 4, pdf_not_included: 1 },
      // บิลปกติ = แถว "รวมทั้งสิ้น" ใน CSV · บิลยกเลิกแยกไว้
      totals: { total_weight: "57.360", total_amount: "23830.50", void_total_amount: "31500.00" },
    });
    // ทุก path ใน manifest มีไฟล์ใน zip จริง และ sha256 ตรง · ไฟล์ PDF ใน zip ทุกไฟล์มีใน manifest
    const listed = z.manifest.bills.flatMap((b) => [b.pdf, ...(b.void_pdf ? [b.void_pdf] : [])]);
    for (const f of listed.filter((x) => x.path !== null)) expect(sha256Hex(z.entry(f.path ?? ""))).toBe(f.sha256);
    expect(receiptsIn(z.names)).toEqual(listed.flatMap((f) => (f.path ? [f.path] : [])));
    // ยอดบิลปกติใน manifest รวมกันได้ total_amount · ตรงกับแถวรวมทั้งสิ้นของ CSV
    const active = z.manifest.bills.filter((b) => b.status === "active");
    expect(fmtMoney(active.reduce((s, b) => s.plus(D(b.total_amount)), ZERO))).toBe(z.manifest.totals.total_amount);
    const csvText = new TextDecoder().decode(z.csv);
    expect(csvText).toContain(`รวมทั้งสิ้น,,,,ทุกสาขา,,,ทุกประเภท (3 ใบ),57.360,23830.50,`);
  });

  it("ขอบเดือน: 1 และ 31 ต.ค. อยู่ · 30 ก.ย. และ 1 พ.ย. ไม่อยู่ — แต่ละเดือนได้บิลของตัวเอง", async () => {
    const hq = `branch_id=${t.branches["00000"]}`;
    const oct = await download(`${OCT}&${hq}`);
    expect(oct.manifest.bills.map((b) => [b.date, b.doc_no])).toEqual([
      ["2026-10-01", "RC6910-0001"],
      ["2026-10-15", "RC6910-0002"],
      ["2026-10-20", "RC6910-0003"],
      ["2026-10-31", "RC6910-0004"],
    ]);
    expect(oct.names.join()).not.toMatch(/RC6909|RC6911/);
    const sep = await download(`year=2026&month=09&${hq}`);
    expect(sep.manifest.bills.map((b) => b.doc_no)).toEqual(["RC6909-0001"]);
    expect(receiptsIn(sep.names)).toEqual(["receipts/00000/RC6909-0001.pdf"]);
    expect(sep.entries.every((e) => e.modified === "2026-09-01 00:00:00")).toBe(true);
    // เดือนปัจจุบัน (ยังไม่จบเดือน) export ได้ — เห็นบิลถึงตอนนี้
    const nov = await download(`year=2026&month=11&${hq}`);
    expect(nov.manifest.bills.map((b) => b.doc_no)).toEqual(["RC6911-0001"]);
    // เดือนที่ไม่มีบิล = zip ที่มี README · CSV · manifest ว่าง
    const aug = await download(`year=2026&month=8&${hq}`);
    expect(aug.names).toEqual(["README.txt", "purchase-report.csv", "manifest.json"]);
    expect(aug.manifest.counts).toEqual({
      bills: 0,
      active: 0,
      void: 0,
      pdf_expected: 0,
      pdf_included: 0,
      pdf_not_included: 0,
    });
  });

  it("scoping: บัญชีสาขาเดียวได้เฉพาะสาขานั้น · branch_id ที่อ่านไม่ได้/ไม่มี/ผิดรูป = 404 ไม่ใช่ทุกสาขา", async () => {
    const own = await download(OCT, "acct2");
    expect(receiptsIn(own.names)).toEqual(["receipts/00002/RC6910-0001.pdf"]);
    expect(own.manifest.generated_for.branches).toEqual([ref("00002")]);
    expect(own.manifest.bills.map((b) => [b.branch_code, b.doc_no])).toEqual([["00002", "RC6910-0001"]]);
    // CSV ของสาขาเดียว — ไม่มีแถวของสาขาอื่น
    const csvText = new TextDecoder().decode(own.csv);
    expect(csvText).not.toContain("00000 ");
    expect(csvText).not.toContain("00001 ");
    expect(own.manifest.totals).toEqual({ total_weight: "7.777", total_amount: "25555.55", void_total_amount: "0.00" });

    const before = (await exportAudits()).length;
    for (const qs of [`branch_id=${t.branches["00000"]}`, `branch_id=${NO_BRANCH}`, "branch_id=not-a-uuid"]) {
      const res = await request(`${OCT}&${qs}`, "acct2");
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/json");
    }
    expect((await request(`${OCT}&branch_id=${NO_BRANCH}`, "admin")).status).toBe(404);
    expect((await exportAudits()).length).toBe(before); // ไม่มีอะไรถูกส่ง = ไม่มี audit

    // admin เลือกสาขาเดียว = เฉพาะสาขานั้น · branch_id ว่าง = ทุกสาขาที่อ่านได้
    const one = await download(`${OCT}&branch_id=${t.branches["00001"]}`, "admin");
    expect(one.manifest.bills.every((b) => b.branch_code === "00001")).toBe(true);
    expect(receiptsIn(one.names).every((n) => n.startsWith("receipts/00001/"))).toBe(true);
    const blank = await download(`${OCT}&branch_id=`, "admin");
    expect(blank.manifest.generated_for.branches.map((b) => b.code)).toEqual(["00000", "00001", "00002"]);
  });

  it("สาขาที่ปิดแล้ว: accounting/admin ยัง export ย้อนหลังได้ (forUserHistory) · บัญชีที่มีเฉพาะสาขานั้นก็ยังได้", async () => {
    await t.db.update(branch).set({ isActive: false }).where(eq(branch.code, "00002"));
    try {
      for (const who of ["acct", "admin"]) {
        const z = await download(OCT, who);
        expect(z.manifest.generated_for.branches.map((b) => b.code)).toEqual(["00000", "00001", "00002"]);
        expect(z.names).toContain("receipts/00002/RC6910-0001.pdf");
      }
      const own = await download(`${OCT}&branch_id=${t.branches["00002"]}`, "acct2");
      expect(receiptsIn(own.names)).toEqual(["receipts/00002/RC6910-0001.pdf"]);
    } finally {
      await t.db.update(branch).set({ isActive: true }).where(eq(branch.code, "00002"));
    }
  });

  it("ไฟล์ใน bucket ไม่ตรง sha256 → ไม่ใส่ใน zip · manifest = sha_mismatch พร้อม sha256 ที่บันทึกไว้ · log แจ้งผู้ดูแล", async () => {
    exportLogs.length = 0;
    const z = await download(`${OCT}&branch_id=${t.branches["00001"]}`);
    const b10 = await receipt(bills.b10 ?? "");
    expect(z.manifest.bills.find((b) => b.doc_no === "RC6910-0004")?.pdf).toEqual({
      path: null,
      sha256: b10.pdfSha256,
      status: "sha_mismatch",
    });
    expect(z.names).not.toContain("receipts/00001/RC6910-0004.pdf");
    expect(Buffer.from(z.bytes).includes("TAMPERED")).toBe(false);
    expect(exportLogs.some((l) => l.includes(b10.pdfKey ?? "?") && l.includes("sha_mismatch"))).toBe(true);
  });

  it("PDF ที่ยังไม่พร้อม (pending · failed · invalid · หาไม่พบ · ฉบับยกเลิกที่ยังไม่เสร็จ) อยู่ใน manifest ไม่มีไฟล์ — ดาวน์โหลดสำเร็จ", async () => {
    const z = await download(`${OCT}&branch_id=${t.branches["00001"]}`);
    const b12 = await receipt(bills.b12 ?? "");
    expect(
      z.manifest.bills.map((b) => [b.doc_no, b.status, b.pdf.status, b.pdf.path, b.void_pdf?.status ?? null]),
    ).toEqual([
      ["RC6910-0001", "active", "ready", "receipts/00001/RC6910-0001.pdf", null],
      ["RC6910-0002", "void", "ready", "receipts/00001/RC6910-0002.pdf", "pending"],
      ["RC6910-0003", "active", "failed", null, null],
      ["RC6910-0004", "active", "sha_mismatch", null, null],
      ["RC6910-0005", "active", "invalid", null, null],
      ["RC6910-0006", "active", "missing", null, null],
    ]);
    expect(z.manifest.bills[1]?.void_pdf).toEqual({ path: null, sha256: null, status: "pending" });
    expect(z.manifest.bills[5]?.pdf.sha256).toBe(b12.pdfSha256);
    expect(receiptsIn(z.names)).toEqual(["receipts/00001/RC6910-0001.pdf", "receipts/00001/RC6910-0002.pdf"]);
    expect(z.manifest.counts).toEqual({
      bills: 6,
      active: 5,
      void: 1,
      pdf_expected: 7,
      pdf_included: 2,
      pdf_not_included: 5,
    });
  });

  it("บิลยกเลิก: ทั้งฉบับเดิมและฉบับยกเลิก (…_void.pdf) อยู่ใน zip เป็นคนละไฟล์ ตรงกับที่เก็บไว้", async () => {
    const z = await download(`${OCT}&branch_id=${t.branches["00000"]}`);
    const b2 = await receipt(bills.b2 ?? "");
    expect(b2.pdfKey).toBe("receipts/00000/2026/10/RC6910-0002.pdf");
    expect(b2.voidPdfKey).toBe("receipts/00000/2026/10/RC6910-0002_void.pdf");
    const original = z.entry("receipts/00000/RC6910-0002.pdf");
    const voided = z.entry("receipts/00000/RC6910-0002_void.pdf");
    expect(original).toEqual((await rawGet(b2.pdfKey ?? ""))?.body);
    expect(voided).toEqual((await rawGet(b2.voidPdfKey ?? ""))?.body);
    expect(original).not.toEqual(voided);
    expect([sha256Hex(original), sha256Hex(voided)]).toEqual([b2.pdfSha256, b2.voidPdfSha256]);
  });

  it("deterministic: ข้อมูลเดิม = byte เดิม — ดาวน์โหลดซ้ำ · คนละวัน · bucket ตอบสลับลำดับ", async () => {
    const first = await download(OCT);
    const second = await download(OCT);
    expect(second.bytes).toEqual(first.bytes);
    // หลายเดือนต่อมา (ไม่มีเวลาที่สร้างในไฟล์)
    clock = new Date("2027-03-01T08:00:00Z");
    try {
      expect((await download(OCT)).bytes).toEqual(first.bytes);
    } finally {
      clock = NOW;
    }
    // ไฟล์ของสาขา 00000 (ต้นลำดับ) ตอบช้ากว่าสาขาอื่น — ลำดับใน zip ต้องไม่เปลี่ยน
    t.storage.get = async (key) => {
      await new Promise((resolve) => setTimeout(resolve, key.startsWith("receipts/00000/") ? 40 : 0));
      return rawGet(key);
    };
    try {
      expect((await download(OCT)).bytes).toEqual(first.bytes);
    } finally {
      t.storage.get = rawGet;
    }
  });

  it("audit export.monthly ทุกครั้งที่ดาวน์โหลด — {year, month, branch_ids, bill_count} ไม่มีข้อมูลลูกค้า", async () => {
    const before = await exportAudits();
    await download(OCT, "acct2");
    await download(`${OCT}&branch_id=${t.branches["00001"]}`, "admin");
    const rows = (await exportAudits()).filter((r) => !before.some((b) => b.id === r.id));
    expect(rows.map((r) => [r.userId, r.tableName, r.rowId, r.diff])).toEqual([
      [
        userIds.acct2,
        "buy_receipt",
        "2026-10",
        { year: 2026, month: 10, branch_ids: [t.branches["00002"]], bill_count: 1 },
      ],
      [
        userIds.admin,
        "buy_receipt",
        "2026-10",
        { year: 2026, month: 10, branch_ids: [t.branches["00001"]], bill_count: 6 },
      ],
    ]);
    const all = await exportAudits();
    for (const r of all) {
      const text = JSON.stringify(r.diff);
      for (const pii of [ID_A, ID_B, ID_C, ...Object.values(NAMES)]) expect(text).not.toContain(pii);
    }
  });

  // lib/fetchSite.ts ต่อจริงในแอปและอยู่ก่อน handler — ลิงก์จากเว็บอื่นพา browser ของฝ่ายบัญชีที่ login อยู่มาโหลด
  // zip ไม่ได้ และไม่ทิ้ง audit ที่ดูเหมือนเจ้าตัวสั่งเอง (cookie SameSite=Lax ยังถูกแนบมากับ top-level GET)
  it("Sec-Fetch-Site: cross-site = 403 ไม่ได้ zip ไม่ลง audit · same-origin / ไม่มี header ยังดาวน์โหลดได้", async () => {
    const before = (await exportAudits()).length;
    const site = (value?: string, method = "GET") =>
      t.app.request(`/api/reports/export?${OCT}`, {
        method,
        headers: {
          origin: "http://localhost:8787",
          cookie: cookies.acct ?? "",
          ...(value === undefined ? {} : { "sec-fetch-site": value }),
        },
      });

    for (const value of ["cross-site", "same-site"]) {
      const res = await site(value);
      expect(res.status, value).toBe(403);
      expect(await res.json()).toEqual({ error: "เปิดไฟล์นี้จากเว็บอื่นไม่ได้ — เปิดจากหน้าระบบโดยตรง" });
    }
    // HEAD ข้ามเว็บก็ไม่ผ่าน — ไม่ให้วัดได้ว่าเดือนนั้นมีไฟล์ชื่ออะไร
    expect((await site("cross-site", "HEAD")).status).toBe(403);
    expect(await exportAudits()).toHaveLength(before);

    // ฝ่ายบัญชีต้องดาวน์โหลดได้ตามปกติ: หน้าระบบของเราเอง · เปิดจาก bookmark · curl ที่ไม่ส่ง header
    for (const value of ["same-origin", "none", undefined]) {
      const res = await site(value);
      expect(res.status, String(value)).toBe(200);
      // อ่าน body ให้จบ — zip ส่งแบบ stream
      expect(readZip(new Uint8Array(await res.arrayBuffer())).length).toBeGreaterThan(0);
    }
    expect(await exportAudits()).toHaveLength(before + 3);
  });

  it("เลขบัตรเต็ม/ชื่อไม่หลุดในไฟล์ที่ไม่ใช่ PDF (manifest · README) · CSV มาสก์เลขบัตร", async () => {
    const z = await download(OCT);
    const manifest = new TextDecoder().decode(z.entry("manifest.json"));
    for (const text of [manifest, z.readme]) {
      for (const pii of [ID_A, ID_B, ID_C, ...Object.values(NAMES)]) expect(text).not.toContain(pii);
    }
    const csvText = new TextDecoder().decode(z.csv);
    for (const id of [ID_A, ID_B, ID_C]) expect(csvText).not.toContain(id);
    expect(csvText).toContain("1 XXXX XXXXX 45 8");
  });

  it.each([
    ["month=10", "year"],
    ["year=26&month=10", "year"],
    ["year=1999&month=12", "year"],
    ["year=2026", "month"],
    ["year=2026&month=13", "month"],
    ["year=2026&month=0", "month"],
    ["year=2026&month=ต.ค.", "month"],
    [`year=2026&month=10&branch_id=${"x".repeat(65)}`, "branch_id"],
    // เดือนที่ยังไม่ถึง (เวลาไทย 5 พ.ย. 2569)
    ["year=2026&month=12", "month"],
    ["year=2027&month=1", "year"],
  ])("query ผิด %s → 400 ชี้ %s", async (qs, field) => {
    const res = await request(qs, "acct");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field });
  });

  it("HEAD = header อย่างเดียว — ไม่อ่านบิล ไม่ดึงไฟล์ ไม่ลง audit", async () => {
    const before = (await exportAudits()).length;
    const res = await request(OCT, "acct", "HEAD");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="ong-export-2026-10.zip"');
    expect((await exportAudits()).length).toBe(before);
  });

  it("stream: response เริ่มก่อนดึง PDF ครบ (ไม่รอทั้งเดือน) — ได้ไฟล์ครบเมื่อ bucket ตอบ", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let fetched = 0;
    t.storage.get = async (key) => {
      await gate;
      fetched++;
      return rawGet(key);
    };
    try {
      const res = await request(OCT, "acct");
      expect(res.status).toBe(200);
      expect(fetched).toBe(0); // header ออกไปแล้วโดยยังไม่มีไฟล์ไหนมาจาก bucket
      release();
      expect(receiptsIn(readZip(await readAll(res)).map((e) => e.name))).toHaveLength(7);
    } finally {
      release();
      t.storage.get = rawGet;
    }
  });

  it("bucket ล้มกลางทาง → ดาวน์โหลดล้ม (ไม่มี zip ที่ดูครบแต่ขาดไฟล์)", async () => {
    t.storage.get = async (key) => {
      if (key.includes("RC6910-0004")) throw new Error("bucket unavailable");
      return rawGet(key);
    };
    try {
      const res = await request(`${OCT}&branch_id=${t.branches["00000"]}`, "acct");
      expect(res.status).toBe(200);
      await expect(readAll(res)).rejects.toThrow("bucket unavailable");
    } finally {
      t.storage.get = rawGet;
    }
  });

  it("bucket ค้างเกินงบเวลารวม → ยกเลิกทั้งไฟล์ (ExportTimeoutError)", async () => {
    const hanging: Storage = { ...t.storage, get: () => new Promise(() => undefined) };
    const plan = await prepareMonthlyExport(t.db, [ref("00000")], exportPeriod(2026, 10), userIds.acct ?? "");
    const log = { error: vi.fn(), warn: vi.fn() };
    const started = Date.now();
    await expect(readAll(streamMonthlyExport(plan, hanging, { storageTimeoutMs: 150, log }))).rejects.toBeInstanceOf(
      ExportTimeoutError,
    );
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(log.error).toHaveBeenCalled();
    // ลง audit แล้วตั้งแต่เตรียมไฟล์ (ขอดาวน์โหลดแล้ว แม้ส่งไม่สำเร็จ)
    const rows = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "export.monthly"), eq(auditLog.userId, userIds.acct ?? "")));
    expect(rows.length).toBeGreaterThan(0);
  });
});

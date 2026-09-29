import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "restore-doc-counters.sh");
const REPO = join(import.meta.dirname, "../..");
const BASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://ong:ong@localhost:5432/postgres";

type Result = { status: number | null; stdout: string; stderr: string };

/** Media listing (หนึ่ง key ต่อบรรทัด แบบ rclone lsf -R) → SQL */
function generate(keys: string[]): Result {
  const r = spawnSync("bash", [SCRIPT], { input: keys.join("\n") + "\n", encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** psql แบบเดียวกับใน runbook (-X ไม่อ่าน psqlrc · ON_ERROR_STOP) · -At = ผลเป็นบรรทัด คั่นด้วย | */
function psql(url: string, sql: string): Result {
  const r = spawnSync("psql", ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-f", "-", url], {
    input: sql,
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const rows = (r: Result) => r.stdout.split("\n").filter(Boolean);

/** key ของ PDF ตาม apps/api/src/lib/pdfArchive.ts */
const receipt = (branch: string, doc: string, month = "10", suffix = "") =>
  `receipts/${branch}/2026/${month}/${doc}${suffix}.pdf`;
const idcard = (branch: string, doc: string, month = "10") => `idcards/${branch}/2026/${month}/${doc}.pdf`;

describe("restore-doc-counters.sh — อ่าน Media listing", () => {
  it("ใบรับซื้อ ฉบับยกเลิก และสำเนาบัตรของเลขเดียวกัน = เลขเดียว · ไม่สนไฟล์อื่น", () => {
    const r = generate([
      receipt("00000", "RC6910-0031"),
      receipt("00000", "RC6910-0031", "10", "_void"),
      idcard("00000", "RC6910-0031"),
      "photos/5b0e5c9e-0000-4000-8000-000000000000/a1b2.jpg",
      "probes/conditional-write-5b0e5c9e.txt",
    ]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("-- 3 archive PDF key(s) · 1 document number(s)");
    expect(r.stdout).toContain("  ('00000', 'RC6910-0031', '6910', 31);");
  });

  it("อักษรนำสาขา · ลำดับ ≥ 10000 · งวดใหม่ · บรรทัด CRLF", () => {
    const r = generate([
      receipt("00002", "PT-RC6910-0007") + "\r",
      receipt("00001", "RC6910-10002"),
      receipt("00000", "RC6911-0003", "11"),
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("('00002', 'PT-RC6910-0007', '6910', 7)");
    expect(r.stdout).toContain("('00001', 'RC6910-10002', '6910', 10002)");
    expect(r.stdout).toContain("('00000', 'RC6911-0003', '6911', 3)");
  });

  it.each([
    ["receipts/00000/RC6909-0001.pdf", "expected <kind>"],
    [receipt("00000", "INV6910-0001"), "doc_no is not"],
    [receipt("00000", "XRC6910-0001"), "doc_no is not"],
    [receipt("00000", "RC6910-0001", "11"), "does not match folder"],
    [receipt("00000", "RC6910-0000"), "month/running"],
    ["idcards/00000/2026/10/RC6910-0001.png", "not a .pdf"],
    [receipt("00000", "RC6910-0001';drop table branch;--"), "doc_no"],
    [receipt("..", "RC6910-0001"), "branch code"],
  ])("key ใต้ receipts/ idcards/ ที่อ่านไม่ออก %j = หยุด (exit 2) ไม่พิมพ์ SQL", (key, why) => {
    const r = generate([receipt("00000", "RC6910-0001"), key]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain(key);
    expect(r.stderr).toContain(why);
  });

  it("ไม่มี key เอกสารเลย (bucket/path ผิด?) = หยุด (exit 1)", () => {
    const r = generate(["photos/x/a.jpg"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/no receipts\/ or idcards\/ PDF keys/);
  });
});

/** psql + Postgres สำหรับเทสต์ — เครื่อง dev ที่ไม่มีข้าม · CI ต้องมีเสมอ (ไม่งั้น fail) */
function databaseAvailable(): boolean {
  const r = spawnSync("psql", ["-X", "-At", "-c", "select 1", BASE_URL], { encoding: "utf8", timeout: 15_000 });
  if (r.status === 0) return true;
  const why = r.error ? r.error.message : r.stderr.trim();
  if (process.env.CI) throw new Error(`restore-doc-counters: psql/Postgres ใช้ไม่ได้ใน CI (${BASE_URL}): ${why}`);
  console.warn(`[backup tests] ข้ามเทสต์ SQL ของ restore-doc-counters — ${why}`);
  return false;
}

describe.skipIf(!databaseAvailable())("restore-doc-counters.sh — SQL กับ schema จริง (migration + seed)", () => {
  const name = `test_restore_${randomUUID().replaceAll("-", "")}`;
  const url = (() => {
    const u = new URL(BASE_URL);
    u.pathname = `/${name}`;
    return u.toString();
  })();
  const counters = () =>
    rows(
      psql(
        url,
        "select b.code, s.period, s.last_no from doc_sequence s join branch b on b.id = s.branch_id order by 1, 2;",
      ),
    );
  const nextDocNo = (branch: string, date: string) =>
    psql(url, `select next_doc_no((select id from branch where code = '${branch}'), 'RC', '${date}');`).stdout.trim();

  beforeAll(() => {
    const created = psql(BASE_URL, `create database ${name};`);
    if (created.status !== 0) throw new Error(created.stderr);
    for (const task of ["migrate", "seed"]) {
      const r = spawnSync("pnpm", ["--filter", "@ong/db", task], {
        cwd: REPO,
        env: { ...process.env, DATABASE_URL: url },
        encoding: "utf8",
      });
      if (r.status !== 0) throw new Error(`pnpm --filter @ong/db ${task}: ${r.stdout}${r.stderr}`);
    }
    // สภาพตอน dump: สาขา 00000 ออกถึง RC6910-0031 (มีบิลในฐาน) · สาขา 00001 ตัวนับ 50 (สูงกว่าที่มี PDF)
    // ข้อมูลสมมติ — เลขบัตรที่ checksum ถูกแต่ไม่ใช่ของจริง
    const fixture = psql(
      url,
      `BEGIN;
INSERT INTO "user" (id, name, email) VALUES ('restore-test-user', 'restore test', 'restore@ong.test');
INSERT INTO customer (id, national_id, name_th)
VALUES ('11111111-1111-4111-8111-111111111111', '1103700123458', 'ลูกค้าทดสอบ');
INSERT INTO buy_receipt (id, branch_id, doc_no, date, time, customer_id, customer_snapshot,
  gold_price_snapshot, total_weight, total_amount, created_by, idempotency_key)
SELECT '22222222-2222-4222-8222-222222222222', id, 'RC6910-0031', '2026-10-05', '10:00',
  '11111111-1111-4111-8111-111111111111', '{}'::jsonb, 40000, 1.000, 1000.00, 'restore-test-user', 'restore-1'
FROM branch WHERE code = '00000';
INSERT INTO payment (receipt_id, method, amount) VALUES ('22222222-2222-4222-8222-222222222222', 'cash', 1000.00);
INSERT INTO doc_sequence (branch_id, prefix, period, last_no) SELECT id, 'RC', '6910', 31 FROM branch WHERE code = '00000';
INSERT INTO doc_sequence (branch_id, prefix, period, last_no) SELECT id, 'RC', '6910', 50 FROM branch WHERE code = '00001';
COMMIT;`,
    );
    if (fixture.status !== 0) throw new Error(fixture.stderr);
  }, 120_000);

  afterAll(() => {
    psql(BASE_URL, `drop database if exists ${name} with (force);`);
  });

  // หลัง dump: 00000 ออก 0032–0045 (มี PDF · ยกเลิก · สำเนาบัตร) และขึ้นงวด 6911 · 00001 มี PDF ถึงแค่ 0040
  // สาขา 00002 (อักษรนำ PT) ออกเลขแรกหลัง dump — ยังไม่มีตัวนับในฐาน
  const LISTING = [
    receipt("00000", "RC6910-0031"),
    ...Array.from({ length: 14 }, (_, i) => receipt("00000", `RC6910-${String(32 + i).padStart(4, "0")}`)),
    receipt("00000", "RC6910-0045", "10", "_void"),
    idcard("00000", "RC6910-0045"),
    receipt("00000", "RC6911-0003", "11"),
    receipt("00001", "RC6910-0040"),
    receipt("00002", "PT-RC6910-0007"),
    "photos/5b0e5c9e-0000-4000-8000-000000000000/a1b2.jpg",
  ];

  it("ยกตัวนับถึงเลขสูงสุดที่มี PDF · ไม่ลดตัวที่สูงกว่า · สร้างตัวนับของงวดใหม่ · รายงานบิลที่หายจากฐาน", () => {
    const sql = generate(LISTING);
    expect(sql.status).toBe(0);
    const r = psql(url, sql.stdout);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    // ผลตรวจในไฟล์ SQL: สาขา|งวด|เลขสูงสุดที่มี PDF|ตัวนับ
    expect(rows(r)).toEqual(
      expect.arrayContaining(["00000|6910|45|45", "00000|6911|3|3", "00001|6910|40|50", "00002|6910|7|7"]),
    );
    // บิลที่มี PDF แต่ไม่มีในฐาน = ส่งบัญชี — ไม่รวม RC6910-0031 ที่มีอยู่แล้ว
    const missing = rows(r).filter((l) => /^\d{5}\|[A-Z-]*RC\d{4}-\d+$/.test(l));
    expect(missing).toHaveLength(14 + 1 + 1 + 1);
    expect(missing).not.toContain("00000|RC6910-0031");
    expect(missing).toEqual(expect.arrayContaining(["00000|RC6910-0032", "00000|RC6910-0045", "00002|PT-RC6910-0007"]));

    expect(counters()).toEqual(["00000|6910|45", "00000|6911|3", "00001|6910|50", "00002|6910|7"]);
  });

  it("รันซ้ำได้ — ไม่เปลี่ยนอะไร", () => {
    const before = counters();
    expect(psql(url, generate(LISTING).stdout).status).toBe(0);
    expect(counters()).toEqual(before);
  });

  it("รหัสสาขาใน Media ที่ไม่มีในฐาน = หยุดทั้งไฟล์ ไม่มีตัวนับไหนเปลี่ยน", () => {
    const before = counters();
    const r = psql(url, generate([receipt("00000", "RC6910-0999"), receipt("99999", "RC6910-0100")]).stdout);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/branch code\(s\) in Media but not in table branch: 99999/);
    expect(counters()).toEqual(before);
  });

  it("บิลถัดไปต่อจากเลขสูงสุดที่มี PDF — ไม่ออกเลขซ้ำกับใบที่ออกไปแล้ว", () => {
    expect(nextDocNo("00000", "2026-10-20")).toBe("RC6910-0046");
    expect(nextDocNo("00000", "2026-11-02")).toBe("RC6911-0004");
    expect(nextDocNo("00001", "2026-10-20")).toBe("RC6910-0051");
    expect(nextDocNo("00002", "2026-10-20")).toBe("RC6910-0008");
  });
});

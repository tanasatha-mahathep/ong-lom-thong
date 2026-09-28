import { auditLog, branch, customer } from "@ong/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BRANCH_MSG } from "../services/branches";
import { type TestApp, databaseAvailable, startTestApp } from "../test/harness";
import { openTransaction, waitForLockWait } from "../test/locks";

const available = await databaseAvailable();
const PW = "correct-horse-battery";
const EVIL = "https://evil.example";
const NO_UUID = "00000000-0000-4000-8000-000000000000";
// เลขบัตรสมมติที่ checksum ถูก — ห้ามใช้ข้อมูลลูกค้าจริง (CLAUDE.md กฎ 8)
const ID_A = "1103700123458";

interface BranchJson {
  id: string;
  code: string;
  name: string;
  short_name: string | null;
  tax_branch_code: string | null;
  tax_branch_label: string | null;
  address: string | null;
  tel: string | null;
  doc_prefix: string | null;
  sort_order: number;
  is_active: boolean;
  has_bills: boolean;
  created_at: string;
}
interface AffectedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  via: "main" | "allowed";
  becomes_branchless: boolean;
}
interface MeBody {
  branch: { code: string } | null;
  branches: { code: string }[];
}

describe.skipIf(!available)("ผู้ดูแล: สาขา — /api/admin/branches", () => {
  let t: TestApp;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    t = await startTestApp();
    const accounts = [
      // ผู้ดูแลไม่ต้องผูกสาขา — งานตั้งค่าทั้งร้าน
      { who: "admin", role: "admin" as const },
      { who: "staff", branch: "00000" },
      // เห็นทุกสาขา ≠ ผู้ดูแล
      { who: "manager", role: "manager" as const, branch: "00000", viewAll: true },
      { who: "acct", role: "accounting" as const, branch: "00000" },
      { who: "s2", branch: "00002" },
      { who: "multi", branch: "00000", allow: ["00002"] },
      // ไม่มีสาขาหลัก · ทำงานสาขา 00002 ผ่านสาขาที่อนุญาตอย่างเดียว
      { who: "roamer", allow: ["00002"] },
      { who: "gone", branch: "00002", active: false },
    ];
    for (const a of accounts) {
      const created = await t.createUser({ email: `${a.who}@ong.test`, password: PW, ...a });
      ids[a.who] = created.id;
      if (a.active !== false) cookies[a.who] = await t.login(`${a.who}@ong.test`, PW);
    }
  });
  afterAll(async () => {
    await t?.close();
  });

  const list = async (who = "admin") => {
    const res = await t.request("/api/admin/branches", { cookie: cookies[who] });
    expect(res.status).toBe(200);
    return ((await res.json()) as { items: BranchJson[] }).items;
  };
  const create = async (body: unknown, who = "admin", origin?: string) =>
    t.request("/api/admin/branches", { cookie: cookies[who], body, origin });
  const update = async (id: string, body: unknown, who = "admin", origin?: string) =>
    t.request(`/api/admin/branches/${id}`, { method: "PUT", cookie: cookies[who], body, origin });
  const me = async (who: string) => (await (await t.request("/api/me", { cookie: cookies[who] })).json()) as MeBody;
  const branchCount = async () => (await t.db.select({ id: branch.id }).from(branch)).length;
  const audits = (action: string) =>
    t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tableName, "branch"), eq(auditLog.action, action)));
  /** บิลหนึ่งใบแบบที่ POST /buy เขียน: next_doc_no() ก่อน แล้วหัวบิล + ชำระ (trigger ตรวจยอดตอน commit) */
  const insertBill = async (sql: Awaited<ReturnType<typeof openTransaction>>["sql"], branchId: string, key: string) => {
    let [cust] = await t.db.select({ id: customer.id }).from(customer).where(eq(customer.nationalId, ID_A));
    if (!cust)
      [cust] = await t.db
        .insert(customer)
        .values({ nationalId: ID_A, nameTh: "นายทดสอบ สาขา" })
        .returning({ id: customer.id });
    const snapshot = JSON.stringify({ national_id: ID_A, name_th: "นายทดสอบ สาขา" });
    const [seq] = await sql<
      { doc_no: string }[]
    >`select next_doc_no(${branchId}::uuid, 'RC', '2026-10-05'::date) as doc_no`;
    const [receipt] = await sql<{ id: string }[]>`
      insert into buy_receipt (branch_id, doc_no, date, time, customer_id, customer_snapshot, gold_price_snapshot,
                               total_weight, total_amount, created_by, idempotency_key)
      values (${branchId}, ${seq?.doc_no ?? ""}, '2026-10-05', '10:00', ${cust?.id ?? ""}, ${snapshot}::jsonb, '67850',
              '5.860', '20030', ${ids.admin ?? ""}, ${key})
      returning id`;
    await sql`insert into payment (receipt_id, method, amount) values (${receipt?.id ?? ""}, 'cash', '20030')`;
  };
  const auditCount = async () =>
    (await t.db.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.tableName, "branch"))).length;

  // ---------- สิทธิ์ ----------

  it("ไม่มี session = 401 ทุก endpoint", async () => {
    expect((await t.request("/api/admin/branches")).status).toBe(401);
    expect((await t.request("/api/admin/branches", { body: { code: "00009", name: "x" } })).status).toBe(401);
    const put = await t.request(`/api/admin/branches/${t.branches["00001"]}`, { method: "PUT", body: { name: "x" } });
    expect(put.status).toBe(401);
    expect(await branchCount()).toBe(3);
  });

  it.each(["staff", "manager", "acct"])("%s (ไม่ใช่ admin) = 403 ทุก endpoint แม้เห็นทุกสาขา", async (who) => {
    const responses = [
      await t.request("/api/admin/branches", { cookie: cookies[who] }),
      await create({ code: "00009", name: "สาขาแอบเพิ่ม" }, who),
      await update(t.branches["00001"] ?? "", { name: "แอบแก้", is_active: false }, who),
    ];
    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    }
    expect(await branchCount()).toBe(3);
    expect(await auditCount()).toBe(0);
    const [b1] = await t.db.select().from(branch).where(eq(branch.code, "00001"));
    expect(b1).toMatchObject({ name: "สาขา 2", isActive: true });
  });

  it("CSRF: origin อื่น / ไม่มี Origin = 403 และไม่มีอะไรเปลี่ยน · GET ไม่เปิด CORS", async () => {
    expect((await create({ code: "00009", name: "x" }, "admin", EVIL)).status).toBe(403);
    expect((await update(t.branches["00001"] ?? "", { is_active: false }, "admin", EVIL)).status).toBe(403);
    const noOrigin = await t.app.request("/api/admin/branches", {
      method: "POST",
      headers: { cookie: cookies.admin ?? "", "content-type": "application/json" },
      body: JSON.stringify({ code: "00009", name: "x" }),
    });
    expect(noOrigin.status).toBe(403);
    expect(await branchCount()).toBe(3);
    expect(await auditCount()).toBe(0);
    // อ่านข้าม origin: browser อ่าน response ไม่ได้เพราะไม่มี Access-Control-Allow-Origin
    const read = await t.request("/api/admin/branches", { cookie: cookies.admin, origin: EVIL });
    expect(read.headers.get("access-control-allow-origin")).toBeNull();
  });

  // ---------- อ่าน ----------

  it("รายการสาขาครบทุกช่อง · ไม่ cache · หัวใบจาก tax_branch_code", async () => {
    const res = await t.request("/api/admin/branches", { cookie: cookies.admin });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const items = ((await res.json()) as { items: BranchJson[] }).items;
    expect(items.map((b) => b.code)).toEqual(["00000", "00001", "00002"]);
    expect(items[0]).toEqual({
      id: t.branches["00000"],
      code: "00000",
      name: "สำนักงานใหญ่ (สาขา 1)",
      short_name: null,
      tax_branch_code: "00000",
      tax_branch_label: "สำนักงานใหญ่",
      address: null,
      tel: null,
      doc_prefix: null,
      sort_order: 0,
      is_active: true,
      has_bills: false,
      created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
    });
    expect(items[1]).toMatchObject({ code: "00001", tax_branch_code: null, tax_branch_label: null });
  });

  // ---------- validation ----------

  it.each([
    [{ name: "ไม่มีรหัส" }, "code", BRANCH_MSG.code],
    [{ code: "0001", name: "4 หลัก" }, "code", BRANCH_MSG.code],
    [{ code: "0000a", name: "ตัวอักษร" }, "code", BRANCH_MSG.code],
    [{ code: 1, name: "ตัวเลข JSON" }, "code", BRANCH_MSG.code],
    [{ code: "00009" }, "name", BRANCH_MSG.name],
    [{ code: "00009", name: "   " }, "name", BRANCH_MSG.name],
    [{ code: "00009", name: "x", tax_branch_code: "123" }, "tax_branch_code", BRANCH_MSG.taxCode],
    [{ code: "00009", name: "x", tax_branch_code: 12345 }, "tax_branch_code", BRANCH_MSG.taxCode],
    [{ code: "00009", name: "x", doc_prefix: "pt" }, "doc_prefix", BRANCH_MSG.docPrefix],
    [{ code: "00009", name: "x", doc_prefix: "ABCDE" }, "doc_prefix", BRANCH_MSG.docPrefix],
    [{ code: "00009", name: "x", sort_order: 1.5 }, "sort_order", BRANCH_MSG.sortOrder],
    [{ code: "00009", name: "x", sort_order: "1" }, "sort_order", BRANCH_MSG.sortOrder],
    [{ code: "00009", name: "x", sort_order: -1 }, "sort_order", BRANCH_MSG.sortOrder],
    [{ code: "00009", name: "x", short_name: "ก".repeat(21) }, "short_name", "ชื่อย่อยาวเกิน 20 ตัวอักษร"],
    [{ code: "00009", name: "x", is_active: "no" }, "is_active", BRANCH_MSG.isActive],
  ])("เพิ่มสาขา: %j → 400 ชี้ %s", async (body, field, error) => {
    const res = await create(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error, field });
  });

  it("body ไม่ใช่ JSON object = 400", async () => {
    for (const body of ["not json", [1, 2], null]) {
      const res = await t.app.request("/api/admin/branches", {
        method: "POST",
        headers: { cookie: cookies.admin ?? "", origin: "http://localhost:8787", "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "ต้องส่งข้อมูลเป็น JSON object" });
    }
    expect(await branchCount()).toBe(3);
  });

  it.each([
    [{ name: "" }, "name", BRANCH_MSG.name],
    [{ name: null }, "name", "ชื่อสาขาต้องเป็นข้อความ"],
    [{ tax_branch_code: "0001" }, "tax_branch_code", BRANCH_MSG.taxCode],
    [{ doc_prefix: "P1" }, "doc_prefix", BRANCH_MSG.docPrefix],
    [{ is_active: 0 }, "is_active", BRANCH_MSG.isActive],
  ])("แก้สาขา: %j → 400 ชี้ %s", async (body, field, error) => {
    const res = await update(t.branches["00001"] ?? "", body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error, field });
  });

  it("ช่องที่ไม่รู้จัก (เช่น camelCase) = 400 ชี้ชื่อช่อง ไม่ใช่เงียบ ๆ ไม่ทำอะไร", async () => {
    const id = t.branches["00001"] ?? "";
    const edited = await update(id, { isActive: false });
    expect(edited.status).toBe(400);
    expect(await edited.json()).toEqual({ error: "ไม่รู้จักช่อง isActive", field: "isActive" });
    const added = await create({ code: "00009", name: "x", has_bills: false });
    expect(added.status).toBe(400);
    expect(await added.json()).toEqual({ error: "ไม่รู้จักช่อง has_bills", field: "has_bills" });
    const [row] = await t.db.select().from(branch).where(eq(branch.id, id));
    expect(row?.isActive).toBe(true);
    expect(await branchCount()).toBe(3);
  });

  it("แก้สาขาที่ไม่มี / id ผิดรูป = 404", async () => {
    expect((await update(NO_UUID, { name: "x" })).status).toBe(404);
    expect((await update("00001", { name: "x" })).status).toBe(404);
  });

  // ---------- เพิ่ม · ห้ามซ้ำ ----------

  it("เพิ่มสาขา → 201 ครบทุกช่อง + audit branch.create", async () => {
    const res = await create({
      code: " 00003 ",
      name: " สาขาป่าตอง ",
      short_name: "ป่าตอง",
      tax_branch_code: "00003",
      address: "99 ถ.ทดสอบ ต.ป่าตอง อ.กะทู้ จ.ภูเก็ต 83150",
      tel: "076-000000",
      doc_prefix: "PT",
      sort_order: 3,
    });
    expect(res.status).toBe(201);
    const { branch: created } = (await res.json()) as { branch: BranchJson };
    expect(created).toMatchObject({
      code: "00003",
      name: "สาขาป่าตอง",
      short_name: "ป่าตอง",
      tax_branch_code: "00003",
      tax_branch_label: "สาขาที่ 00003",
      doc_prefix: "PT",
      sort_order: 3,
      is_active: true,
    });
    ids.b3 = created.id;

    const [row] = await audits("branch.create");
    expect(row).toMatchObject({ userId: ids.admin, rowId: created.id });
    expect(row?.diff).toEqual({
      after: {
        code: "00003",
        name: "สาขาป่าตอง",
        short_name: "ป่าตอง",
        tax_branch_code: "00003",
        address: "99 ถ.ทดสอบ ต.ป่าตอง อ.กะทู้ จ.ภูเก็ต 83150",
        tel: "076-000000",
        doc_prefix: "PT",
        sort_order: 3,
        is_active: true,
      },
    });
  });

  it("ช่องไม่บังคับที่ว่าง = null · ค่าเริ่มต้น sort_order 0 · เปิดอยู่", async () => {
    const res = await create({ code: "00004", name: "สาขา 5", short_name: "", tax_branch_code: "", doc_prefix: null });
    expect(res.status).toBe(201);
    const { branch: created } = (await res.json()) as { branch: BranchJson };
    expect(created).toMatchObject({
      short_name: null,
      tax_branch_code: null,
      tax_branch_label: null,
      doc_prefix: null,
      sort_order: 0,
      is_active: true,
    });
    ids.b4 = created.id;
  });

  it("รหัสสาขาซ้ำ = 409", async () => {
    const before = await auditCount();
    const res = await create({ code: "00001", name: "ซ้ำ" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "รหัสสาขา 00001 มีอยู่แล้ว", field: "code" });
    expect(await auditCount()).toBe(before);
  });

  it("รหัสสรรพากรซ้ำ = 409 บอกว่าชนกับสาขาไหน", async () => {
    const res = await create({ code: "00005", name: "ซ้ำรหัสภาษี", tax_branch_code: "00003" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: BRANCH_MSG.taxCodeTaken("00003", "00003 สาขาป่าตอง"),
      field: "tax_branch_code",
    });
  });

  it("สำนักงานใหญ่ (00000) ที่สอง = 409 ทั้งตอนเพิ่มและตอนแก้", async () => {
    const error = BRANCH_MSG.headOfficeTaken("00000 สำนักงานใหญ่ (สาขา 1)");
    const added = await create({ code: "00005", name: "สำนักงานใหญ่ 2", tax_branch_code: "00000" });
    expect(added.status).toBe(409);
    expect(await added.json()).toEqual({ error, field: "tax_branch_code" });
    const edited = await update(t.branches["00002"] ?? "", { tax_branch_code: "00000" });
    expect(edited.status).toBe(409);
    expect(await edited.json()).toEqual({ error, field: "tax_branch_code" });
    const [b2] = await t.db.select().from(branch).where(eq(branch.code, "00002"));
    expect(b2?.taxBranchCode).toBeNull();
  });

  it("รหัสสรรพากรที่อีกทรานแซกชันกำลังเขียน: รอจนอีกฝ่าย commit แล้วตอบ 409 (ล็อกตารางสาขา ไม่ใช่เช็คแล้วแทรก)", async () => {
    const other = await openTransaction(t.db);
    await other.sql`insert into branch (code, name, tax_branch_code) values ('00007', 'สาขาจากอีกทาง', '00007')`;
    const pending = create({ code: "00017", name: "แข่งกัน", tax_branch_code: "00007" });
    await waitForLockWait(t.db);
    await other.commit();
    const res = await pending;
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: BRANCH_MSG.taxCodeTaken("00007", "00007 สาขาจากอีกทาง"),
      field: "tax_branch_code",
    });
    expect(await t.db.select().from(branch).where(eq(branch.taxBranchCode, "00007"))).toHaveLength(1);
    await t.db.delete(branch).where(eq(branch.code, "00007"));
  });

  it("เพิ่มรหัสเดียวกันพร้อมกัน → สำเร็จหนึ่ง อีกอันได้ 409 (ล็อกตารางสาขา · unique ของรหัสเป็นตาข่ายชั้นสุดท้าย)", async () => {
    const [a, b] = await Promise.all([
      create({ code: "00006", name: "พร้อมกัน ก" }),
      create({ code: "00006", name: "พร้อมกัน ข" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(await loser.json()).toEqual({ error: "รหัสสาขา 00006 มีอยู่แล้ว", field: "code" });
    expect(await t.db.select().from(branch).where(eq(branch.code, "00006"))).toHaveLength(1);
    expect(await audits("branch.create")).toHaveLength(3);
  });

  // ---------- แก้ ----------

  it("รหัสสาขาแก้ไม่ได้ (อยู่ใน key ของ PDF) — ส่งรหัสเดิมมาพร้อมฟอร์มได้", async () => {
    const id = t.branches["00001"] ?? "";
    for (const code of ["00009", 1, null]) {
      const res = await update(id, { code, name: "สาขา 2 ใหม่" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: BRANCH_MSG.codeImmutable, field: "code" });
    }
    const [row] = await t.db.select().from(branch).where(eq(branch.id, id));
    expect(row).toMatchObject({ code: "00001", name: "สาขา 2" });

    const same = await update(id, { code: "00001", name: "สาขา 2 (บ้านไผ่)" });
    expect(same.status).toBe(200);
    expect(((await same.json()) as { branch: BranchJson }).branch).toMatchObject({
      code: "00001",
      name: "สาขา 2 (บ้านไผ่)",
    });
  });

  it("แก้บางช่อง: ช่องที่ไม่ส่งคงเดิม · ส่งว่าง = ล้าง · audit เฉพาะช่องที่เปลี่ยน (before/after)", async () => {
    const res = await update(ids.b3 ?? "", { tel: "076-111111", short_name: "", sort_order: 3 });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { branch: BranchJson }).branch).toMatchObject({
      name: "สาขาป่าตอง",
      tel: "076-111111",
      short_name: null,
      tax_branch_code: "00003",
      doc_prefix: "PT",
    });
    const rows = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "branch.update"), eq(auditLog.rowId, ids.b3 ?? "")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: ids.admin, tableName: "branch" });
    expect(rows[0]?.diff).toEqual({
      tel: { before: "076-000000", after: "076-111111" },
      short_name: { before: "ป่าตอง", after: null },
    });
  });

  it("แก้โดยไม่มีอะไรเปลี่ยน = 200 ไม่ลง audit", async () => {
    const before = await auditCount();
    const res = await update(ids.b3 ?? "", { code: "00003", name: "สาขาป่าตอง", doc_prefix: "PT" });
    expect(res.status).toBe(200);
    expect(await auditCount()).toBe(before);
  });

  it("ย้ายสำนักงานใหญ่: ล้าง 00000 ที่เดิมก่อน แล้วตั้งให้สาขาใหม่ได้", async () => {
    const hq = t.branches["00000"] ?? "";
    expect((await update(hq, { tax_branch_code: null })).status).toBe(200);
    const moved = await update(ids.b4 ?? "", { tax_branch_code: "00000" });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as { branch: BranchJson }).branch.tax_branch_label).toBe("สำนักงานใหญ่");
    // คืนค่า
    expect((await update(ids.b4 ?? "", { tax_branch_code: null })).status).toBe(200);
    expect((await update(hq, { tax_branch_code: "00000" })).status).toBe(200);
  });

  it("เรียงตาม sort_order แล้วตามรหัส · รวมสาขาที่ปิด", async () => {
    expect((await update(ids.b4 ?? "", { is_active: false })).status).toBe(200);
    expect((await update(t.branches["00001"] ?? "", { sort_order: 5 })).status).toBe(200);
    const items = await list();
    expect(items.map((b) => [b.code, b.sort_order, b.is_active])).toEqual([
      ["00000", 0, true],
      ["00002", 0, true],
      ["00004", 0, false],
      ["00006", 0, true],
      ["00003", 3, true],
      ["00001", 5, true],
    ]);
  });

  // ---------- ปิด/เปิดสาขา → สิทธิ์เปลี่ยนทันที ----------

  it("ปิดสาขา: หายจากสิทธิ์ทุกคนทันที (session เดิม) · รายงานผู้ใช้ที่ผูกสาขานี้ (หลัก/ที่อนุญาต)", async () => {
    const id = t.branches["00002"] ?? "";
    expect((await me("s2")).branch?.code).toBe("00002");
    expect((await me("multi")).branches.map((b) => b.code)).toEqual(["00000", "00002"]);

    const res = await update(id, { is_active: false });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { branch: BranchJson; affected_users: AffectedUser[] };
    expect(body.branch.is_active).toBe(false);
    // ผู้ใช้ที่ยังใช้งานอยู่และผูกสาขานี้ — สาขาหลักขึ้นก่อน · gone ถูกปิดบัญชีแล้ว · manager เห็นทุกสาขาแต่ไม่ได้ผูก
    expect(body.affected_users).toEqual([
      { id: ids.s2, email: "s2@ong.test", name: "s2", role: "staff", via: "main", becomes_branchless: true },
      {
        id: ids.multi,
        email: "multi@ong.test",
        name: "multi",
        role: "staff",
        via: "allowed",
        becomes_branchless: false,
      },
      {
        id: ids.roamer,
        email: "roamer@ong.test",
        name: "roamer",
        role: "staff",
        via: "allowed",
        becomes_branchless: true,
      },
    ]);

    const s2 = await me("s2");
    expect(s2.branches).toEqual([]);
    expect(s2.branch).toBeNull();
    expect((await me("multi")).branches.map((b) => b.code)).toEqual(["00000"]);
    expect((await me("roamer")).branches).toEqual([]);
    expect((await me("manager")).branches.map((b) => b.code)).not.toContain("00002");
    // ไม่มีสาขาที่เปิดอยู่เลย = ข้อมูลของร้านอ่านไม่ได้ (fail-closed)
    expect((await t.request("/api/customers", { cookie: cookies.s2 })).status).toBe(403);
    expect((await t.request("/api/me/branch", { cookie: cookies.s2, body: { branch_id: id } })).status).toBe(404);

    const [row] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "branch.update"), eq(auditLog.rowId, id)));
    expect(row?.diff).toEqual({ is_active: { before: true, after: false } });
  });

  it("แก้สาขาที่ปิดอยู่ยังรายงาน affected_users · เปิดคืนแล้วสิทธิ์กลับมาทันที", async () => {
    const id = t.branches["00002"] ?? "";
    const renamed = await update(id, { name: "สาขา 3 (ปิดปรับปรุง)" });
    expect(((await renamed.json()) as { affected_users: AffectedUser[] }).affected_users).toHaveLength(3);

    const res = await update(id, { is_active: true });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { affected_users: AffectedUser[] }).affected_users).toEqual([]);
    const s2 = await me("s2");
    expect(s2.branches.map((b) => b.code)).toEqual(["00002"]);
    expect(s2.branch?.code).toBe("00002");
    expect((await me("multi")).branches.map((b) => b.code)).toEqual(["00000", "00002"]);
    expect((await t.request("/api/customers", { cookie: cookies.s2 })).status).toBe(200);
  });

  // ---------- doc_prefix ล็อกเมื่อมีบิล ----------

  it("doc_prefix แก้ได้ขณะยังไม่มีบิล · has_bills = false", async () => {
    const id = ids.b4 ?? "";
    const set = await update(id, { doc_prefix: "KK" });
    expect(set.status).toBe(200);
    expect(((await set.json()) as { branch: BranchJson }).branch).toMatchObject({ doc_prefix: "KK", has_bills: false });
    expect((await update(id, { doc_prefix: null })).status).toBe(200);
  });

  it("บิลที่กำลังบันทึก (ยังไม่ commit): เปลี่ยน doc_prefix ต้องรอบิลนั้นจบ แล้วได้ 409 — ไม่มีบิลใช้อักษรนำเดิมหลุดไป", async () => {
    const id = t.branches["00001"] ?? "";
    const bill = await openTransaction(t.db);
    await insertBill(bill.sql, id, "admin-branch-race-000001");
    const before = await auditCount();
    const pending = update(id, { doc_prefix: "PT" });
    await waitForLockWait(t.db);
    await bill.commit();

    const res = await pending;
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: BRANCH_MSG.docPrefixLocked, field: "doc_prefix" });
    const [row] = await t.db.select().from(branch).where(eq(branch.id, id));
    expect(row?.docPrefix).toBeNull();
    expect(await auditCount()).toBe(before);
  });

  it("มีบิลแล้ว: ตั้ง/เปลี่ยน/ล้าง doc_prefix = 409 · ส่งค่าเดิมกับช่องอื่นได้ · has_bills = true", async () => {
    const id = ids.b3 ?? "";
    // trigger ตรวจยอดชำระตอน commit — หัวบิลกับชำระต้องอยู่ในทรานแซกชันเดียวกัน
    const tx = await openTransaction(t.db);
    await insertBill(tx.sql, id, "admin-branch-bill-000002");
    await tx.commit();
    for (const doc_prefix of ["PK", null, ""]) {
      const res = await update(id, { doc_prefix });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: BRANCH_MSG.docPrefixLocked, field: "doc_prefix" });
    }
    const same = await update(id, { code: "00003", doc_prefix: "PT", tel: "076-222222" });
    expect(same.status).toBe(200);
    expect(((await same.json()) as { branch: BranchJson }).branch).toMatchObject({
      doc_prefix: "PT",
      tel: "076-222222",
      has_bills: true,
    });
    const bills = Object.fromEntries((await list()).map((b) => [b.code, b.has_bills]));
    expect(bills).toMatchObject({ "00000": false, "00001": true, "00002": false, "00003": true, "00004": false });
  });

  it("ทุกการเขียนที่สำเร็จมี audit ของผู้ดูแลคนนั้น · ที่ล้มไม่มี", async () => {
    const rows = await t.db.select().from(auditLog).where(eq(auditLog.tableName, "branch"));
    expect(rows.every((r) => r.userId === ids.admin)).toBe(true);
    const created = rows.filter((r) => r.action === "branch.create").map((r) => r.rowId);
    const codes = (await t.db.select().from(branch)).filter((b) => created.includes(b.id)).map((b) => b.code);
    expect(codes.sort()).toEqual(["00003", "00004", "00006"]);
  });
});

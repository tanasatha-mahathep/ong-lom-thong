import { isValidNationalId, maskNationalId } from "@ong/core";
import { auditLog, branch, customer } from "@ong/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestApp, databaseAvailable, startTestApp } from "../test/harness";

const available = await databaseAvailable();
const PW = "correct-horse-battery";

// เลขบัตรสมมติที่ checksum ถูก — ห้ามใช้ข้อมูลลูกค้าจริง (CLAUDE.md กฎ 8)
const ID_A = "1103700123458";
const ID_B = "3100500987657";
const ID_C = "5109900112237";
// เลขคนละเลขกับ ID_A แต่มาสก์ออกมาเหมือนกัน ("1 XXXX XXXXX 45 8") — checksum ถูก
const ID_A_TWIN = "1103700997458";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);

interface Detail {
  id: string;
  national_id: string;
  name_th: string;
  mobile: string | null;
  card_status: string;
  card_expire_date: string | null;
  has_photo: boolean;
}
interface ListBody {
  items: {
    id: string;
    national_id_masked: string;
    name_th: string;
    mobile: string | null;
    address: string | null;
    card_status: string;
  }[];
  page: number;
  has_more: boolean;
}

/** 10 ช่องข้อความตามลำดับ Siam ID + รูป (ช่องที่ 9) */
function form(fields: Record<string, string>, photo?: File) {
  const f = new FormData();
  const defaults = {
    national_id: ID_A,
    name_th: "นายทดสอบ ระบบ",
    name_en: "Mr. Test System",
    birthday_text: "01/01/2530",
    religion: "พุทธ",
    address: "1 ถ.ทดสอบ ต.ในเมือง อ.เมือง จ.ขอนแก่น",
    card_issue_text: "01/01/2565",
    card_expire_text: "31/12/2574",
    mobile: "0812345678",
    phone2: "",
  };
  for (const [k, v] of Object.entries({ ...defaults, ...fields })) f.append(k, v);
  if (photo) f.append("photo", photo);
  return f;
}

describe.skipIf(!available)("ลูกค้า (Siam ID · R12 · R13) — /api/customers", () => {
  let t: TestApp;
  const cookies: Record<string, string> = {};
  let idA = "";

  beforeAll(async () => {
    t = await startTestApp({ now: () => new Date("2026-09-28T03:00:00Z") });
    await t.createUser({ email: "staff@ong.test", password: PW, branch: "00000" });
    await t.createUser({ email: "staff2@ong.test", password: PW, branch: "00002" });
    await t.createUser({ email: "nobranch@ong.test", password: PW });
    for (const who of ["staff", "staff2", "nobranch"]) cookies[who] = await t.login(`${who}@ong.test`, PW);
  });
  afterAll(async () => {
    await t?.close();
  });

  const post = (body: FormData, who = "staff") => t.request("/api/customers", { cookie: cookies[who], body });
  const put = (id: string, body: FormData) =>
    t.request(`/api/customers/${id}`, { method: "PUT", cookie: cookies.staff, body });
  const get = (path: string, who = "staff") => t.request(`/api/customers${path}`, { cookie: cookies[who] });

  it("ต้อง login", async () => {
    expect((await t.request("/api/customers")).status).toBe(401);
    expect((await t.request("/api/customers", { body: form({}) })).status).toBe(401);
  });

  it("ไม่มีสิทธิ์สาขาใดเลย = 403 ทั้งอ่านและเขียน (fail-closed)", async () => {
    expect((await get("", "nobranch")).status).toBe(403);
    expect((await post(form({}), "nobranch")).status).toBe(403);
  });

  it("สาขาเดียวที่มีสิทธิ์ถูกปิด = 403", async () => {
    await t.db.update(branch).set({ isActive: false }).where(eq(branch.code, "00002"));
    try {
      expect((await get("", "staff2")).status).toBe(403);
    } finally {
      await t.db.update(branch).set({ isActive: true }).where(eq(branch.code, "00002"));
    }
    expect((await get("", "staff2")).status).toBe(200);
  });

  it("CSRF: origin อื่นเพิ่มลูกค้าไม่ได้", async () => {
    const res = await t.request("/api/customers", {
      cookie: cookies.staff,
      body: form({}),
      origin: "https://evil.test",
    });
    expect(res.status).toBe(403);
  });

  it("เพิ่มลูกค้า 11 ช่อง + รูป → 201 · รูปลง bucket ใต้ photos/<id>/", async () => {
    const res = await post(form({ national_id: "1-1037-00123-45-8" }, new File([PNG], "card.png")));
    expect(res.status).toBe(201);
    idA = ((await res.json()) as { id: string }).id;
    expect(t.storage.keys()).toEqual([expect.stringMatching(new RegExp(`^photos/${idA}/[0-9a-f-]{36}\\.png$`))]);

    const [row] = await t.db.select().from(customer).where(eq(customer.id, idA));
    expect(row).toMatchObject({
      nationalId: ID_A, // ตัดขีดออกก่อนเก็บ
      nameEn: "Mr. Test System",
      cardExpireText: "31/12/2574",
      cardExpireDate: "2031-12-31",
      phone2: null, // ช่องว่าง = null
    });
    expect(row?.createdBy).toBe(row?.updatedBy);
  });

  it("หน้าลูกค้าเดี่ยวเห็นเลขบัตรเต็ม · ไม่ cache", async () => {
    const res = await get(`/${idA}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({
      id: idA,
      national_id: ID_A,
      name_th: "นายทดสอบ ระบบ",
      card_status: "ok",
      card_expire_date: "2031-12-31",
      has_photo: true,
    } satisfies Partial<Detail>);
  });

  it("รายการมาสก์เลขบัตรเสมอ — เลขเต็มไม่หลุดใน response (R13)", async () => {
    const res = await get("");
    const text = await res.text();
    expect(text).not.toContain(ID_A);
    const body = JSON.parse(text) as ListBody;
    expect(body.items).toEqual([
      {
        id: idA,
        national_id_masked: "1 XXXX XXXXX 45 8",
        name_th: "นายทดสอบ ระบบ",
        mobile: "0812345678",
        address: "1 ถ.ทดสอบ ต.ในเมือง อ.เมือง จ.ขอนแก่น",
        card_status: "ok",
      },
    ]);
  });

  it("รูปออกทาง api เท่านั้น: ต้อง login · no-store · nosniff", async () => {
    expect((await t.request(`/api/customers/${idA}/photo`)).status).toBe(401);
    const res = await get(`/${idA}/photo`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it("audit ตอนเพิ่ม — เลขบัตรในบันทึกถูกมาสก์ (R12 · PDPA)", async () => {
    const rows = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "customer.create"), eq(auditLog.rowId, idA)));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]?.diff)).not.toContain(ID_A);
    expect(rows[0]?.diff).toMatchObject({ after: { national_id: "1 XXXX XXXXX 45 8", photo: "set" } });
  });

  it.each([
    [{ national_id: "1103700123459" }, "national_id"],
    [{ national_id: "11037001234" }, "national_id"],
    [{ national_id: "" }, "national_id"],
    [{ name_th: "   " }, "name_th"],
    [{ address: "ก".repeat(1001) }, "address"],
  ])("ข้อมูลผิด %j → 400 ชี้ช่อง", async (fields, field) => {
    const res = await post(form({ ...fields }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field });
  });

  it("ส่ง JSON แทน multipart = 415", async () => {
    const res = await t.request("/api/customers", { cookie: cookies.staff, body: { national_id: ID_B, name_th: "x" } });
    expect(res.status).toBe(415);
  });

  it("เลขบัตรซ้ำ = 409 พร้อม id ลูกค้าเดิม (เขียนเลขคนละรูปแบบก็จับได้)", async () => {
    const res = await post(form({ national_id: "1 1037 00123 45 8", name_th: "คนอื่น" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "มีลูกค้าเลขบัตรนี้อยู่แล้ว", field: "national_id", existing_id: idA });
  });

  it.each([
    [{ national_id: ID_B, name_th: "นาย\u0000ทดสอบ" }, "name_th"],
    [{ national_id: ID_B, address: "1 ถ.ทดสอบ\u0007" }, "address"],
    [{ national_id: ID_B, mobile: "081\u001b234" }, "mobile"],
  ])("อักขระควบคุม %j → 400 ชี้ %s ไม่บันทึก", async (fields, field) => {
    const res = await post(form(fields));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "มีอักขระที่ใช้ไม่ได้", field });
    expect(await t.db.select().from(customer).where(eq(customer.nationalId, ID_B))).toHaveLength(0);
  });

  it("ที่อยู่หลายบรรทัดใช้ได้ (ผ่านการตรวจ ไปติดเลขบัตรซ้ำแทน) · ค้นด้วยอักขระควบคุม = 400", async () => {
    const res = await post(form({ address: "1 ถ.ทดสอบ\r\nต.ในเมือง\tจ.ขอนแก่น" }));
    expect(res.status).toBe(409);
    const q = await get("?q=%00%00");
    expect(q.status).toBe(400);
    expect(await q.json()).toMatchObject({ field: "q" });
  });

  it("รูปตรวจจาก byte จริง — ไฟล์อื่นที่ตั้งชื่อ .jpg ถูกปฏิเสธ และไม่ลง bucket", async () => {
    const before = t.storage.keys().length;
    const fake = new File([new TextEncoder().encode("<svg onload=alert(1)>")], "x.jpg", { type: "image/jpeg" });
    const res = await post(form({ national_id: ID_B }, fake));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: "photo" });
    expect(t.storage.keys()).toHaveLength(before);
    expect(await t.db.select().from(customer).where(eq(customer.nationalId, ID_B))).toHaveLength(0);
  });

  it("รูปใหญ่เกิน 5 MB = 413", async () => {
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set(JPEG);
    const res = await post(form({ national_id: ID_B }, new File([big], "big.jpg")));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ field: "photo" });
  });

  it.each([
    ["01/01/2560", "expired", "2017-01-01"],
    ["28/09/2569", "ok", "2026-09-28"], // หมดอายุวันนี้ยังใช้ได้
    ["ตลอดชีพ", "ok", null],
    ["", "missing", null],
    ["31/02/2570", "invalid", null],
    // ชื่อเดือน (Siam ID · ระบบเดิม · หน้าบัตร) · ค่าดิบจากชิป · บัตรตลอดชีพ
    ["31 ธันวาคม 2574", "ok", "2031-12-31"],
    ["27 ก.ย. 2569", "expired", "2026-09-27"],
    ["28 Sep. 2026", "ok", "2026-09-28"],
    ["25741231", "ok", "2031-12-31"],
    ["LIFELONG", "ok", null],
    ["99999999", "ok", null],
    ["1 มกรา 2570", "invalid", null], // ชื่อเดือนแบบพูด — ต้องสะกดตรงตัว
  ])("สถานะบัตร: หมดอายุ %j → %s", async (card_expire_text, status, date) => {
    const res = await put(idA, form({ card_expire_text }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ card_status: status, card_expire_date: date });
  });

  it("Siam ID พิมพ์ '31 ธันวาคม 2574' → เก็บข้อความดิบ · card_expire_date ค.ศ. · สถานะ ok ทั้งหน้าเดี่ยวและรายการ", async () => {
    const res = await put(idA, form({ card_expire_text: "31 ธันวาคม 2574" }));
    expect(res.status).toBe(200);
    const expected = { card_expire_text: "31 ธันวาคม 2574", card_expire_date: "2031-12-31", card_status: "ok" };
    expect(await res.json()).toMatchObject(expected);
    expect(await (await get(`/${idA}`)).json()).toMatchObject(expected);

    const [row] = await t.db.select().from(customer).where(eq(customer.id, idA));
    expect(row).toMatchObject({ cardExpireText: "31 ธันวาคม 2574", cardExpireDate: "2031-12-31" });
    const list = (await (await get("")).json()) as ListBody;
    expect(list.items.find((c) => c.id === idA)?.card_status).toBe("ok");
  });

  it("แก้ไข: เก็บ audit เฉพาะช่องที่เปลี่ยน · ไม่ส่งรูป = รูปเดิม", async () => {
    await put(idA, form({ card_expire_text: "31/12/2574" }));
    const res = await put(idA, form({ mobile: "0899999999", card_expire_text: "31/12/2574" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mobile: "0899999999", has_photo: true });
    expect(t.storage.keys()).toHaveLength(1);

    const [last] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "customer.update"), eq(auditLog.rowId, idA)))
      .orderBy(auditLog.id)
      .then((rows) => rows.slice(-1));
    expect(last?.diff).toEqual({ mobile: { before: "0812345678", after: "0899999999" } });
  });

  it("แก้ไขโดยไม่เปลี่ยนอะไร = ไม่เพิ่ม audit", async () => {
    const count = async () =>
      (await t.db.select().from(auditLog).where(eq(auditLog.rowId, idA))).filter((r) => r.action === "customer.update")
        .length;
    const before = await count();
    await put(idA, form({ mobile: "0899999999", card_expire_text: "31/12/2574" }));
    expect(await count()).toBe(before);
  });

  it("เปลี่ยนรูป = key ใหม่ ไฟล์เดิมยังอยู่ (ไม่มีการลบ) · audit ไม่เก็บ key", async () => {
    const res = await put(
      idA,
      form({ mobile: "0899999999", card_expire_text: "31/12/2574" }, new File([JPEG], "b.jpg")),
    );
    expect(res.status).toBe(200);
    expect(t.storage.keys()).toHaveLength(2);
    const photo = await get(`/${idA}/photo`);
    expect(photo.headers.get("content-type")).toBe("image/jpeg");
    const [last] = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "customer.update"), eq(auditLog.rowId, idA)))
      .orderBy(auditLog.id)
      .then((rows) => rows.slice(-1));
    expect(last?.diff).toEqual({ photo: { before: "set", after: "replaced" } });
  });

  it("PUT ตอบแบบมาสก์ — เลขบัตรเต็มออกเฉพาะ GET /:id (R13 · spec §5)", async () => {
    const res = await put(idA, form({ mobile: "0899999999", card_expire_text: "31/12/2574" }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(ID_A);
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(body).not.toHaveProperty("national_id");
    expect(body).toMatchObject({
      id: idA,
      national_id_masked: "1 XXXX XXXXX 45 8",
      name_th: "นายทดสอบ ระบบ",
      card_status: "ok",
      has_photo: true,
    });
    expect(((await (await get(`/${idA}`)).json()) as Detail).national_id).toBe(ID_A);
  });

  it("เปลี่ยนเลขบัตรเป็นเลขที่มาสก์ออกมาเหมือนเดิม ต้องลง audit (เทียบค่าดิบ) · audit เก็บแบบมาสก์", async () => {
    expect(isValidNationalId(ID_A_TWIN)).toBe(true);
    expect(maskNationalId(ID_A_TWIN)).toBe(maskNationalId(ID_A));
    const updates = () =>
      t.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "customer.update"), eq(auditLog.rowId, idA)))
        .orderBy(auditLog.id);
    const count = (await updates()).length;
    const same = { mobile: "0899999999", card_expire_text: "31/12/2574" };

    expect((await put(idA, form({ ...same, national_id: ID_A_TWIN }))).status).toBe(200);
    const rows = await updates();
    expect(rows).toHaveLength(count + 1);
    const masked = maskNationalId(ID_A);
    expect(rows.at(-1)?.diff).toEqual({ national_id: { before: masked, after: masked } });
    expect(JSON.stringify(rows.at(-1)?.diff)).not.toMatch(/\d{13}/);

    // คืนเลขเดิม (เทสต์ถัดไปใช้ ID_A) — ก็ลง audit เช่นกัน
    expect((await put(idA, form(same))).status).toBe(200);
    expect(await updates()).toHaveLength(count + 2);
  });

  it("แก้เลขบัตรไปชนคนอื่น = 409 · ข้อมูลเดิมไม่เปลี่ยน", async () => {
    const created = await post(
      form({ national_id: ID_B, name_th: "นางสาวสอง ทดสอบ", name_en: "", mobile: "0922222222" }),
    );
    const idB = ((await created.json()) as { id: string }).id;
    const res = await put(idB, form({ national_id: ID_A, name_th: "นางสาวสอง ทดสอบ" }));
    expect(res.status).toBe(409);
    expect(((await (await get(`/${idB}`)).json()) as Detail).national_id).toBe(ID_B);
  });

  it("ไม่มีรูป / ไม่พบ / id ผิดรูป = 404", async () => {
    const created = await post(form({ national_id: ID_C, name_th: "นายสาม ทดสอบ", name_en: "" }));
    const idC = ((await created.json()) as { id: string }).id;
    expect((await get(`/${idC}/photo`)).status).toBe(404);
    expect((await get("/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await get("/not-a-uuid")).status).toBe(404);
    expect((await put("00000000-0000-4000-8000-000000000000", form({ national_id: ID_C }))).status).toBe(404);
  });

  it.each([
    ["ทดสอบ", 3],
    ["test system", 1], // อังกฤษ ไม่สนตัวพิมพ์
    ["00123", 1], // เลขบัตรบางส่วน
    ["0922222222", 1], // เบอร์
    ["092-222-2222", 1], // เบอร์มีขีด
    ["%%", 0], // wildcard ถูก escape
    ["__", 0],
  ])("ค้น %j → %i ราย", async (q, n) => {
    const res = await get(`?q=${encodeURIComponent(q)}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as ListBody).items).toHaveLength(n);
  });

  it("ค้น 1 ตัวอักษร = 400", async () => {
    const res = await get("?q=ก");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: "q" });
  });

  it("แบ่งหน้าละ 20 · has_more", async () => {
    await t.db.insert(customer).values(
      Array.from({ length: 20 }, (_, i) => ({
        nationalId: `9${String(i).padStart(12, "0")}`,
        nameTh: `ลูกค้าหน้า ${i}`,
      })),
    );
    const p1 = (await (await get("")).json()) as ListBody;
    const p2 = (await (await get("?page=2")).json()) as ListBody;
    expect([p1.items.length, p1.has_more, p2.items.length, p2.has_more]).toEqual([20, true, 3, false]);
    expect(new Set([...p1.items, ...p2.items].map((c) => c.id)).size).toBe(23);
    expect((await get("?page=0")).status).toBe(400);
  });
});

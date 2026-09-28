import { type Role, auditLog, branch, customer, session } from "@ong/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestApp, databaseAvailable, startTestApp } from "../test/harness";
import { expectApiError } from "../test/assertions";
import { expectNoNationalId, nationalIdsIn } from "../test/pii";
import { cardFormat, syntheticNationalId, syntheticSameMask, testName } from "../test/synthetic";

const available = await databaseAvailable();
const PW = "correct-horse-battery";

// เลขบัตรสมมติที่ checksum ถูก — ห้ามใช้ข้อมูลลูกค้าจริง (CLAUDE.md กฎ 8)
const ID_A = "1103700123458";
const ID_B = "3100500987657";
const ID_C = "5109900112237";
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
  items: { id: string; national_id_masked: string; name_th: string; mobile: string | null; card_status: string }[];
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
  ])("สถานะบัตร: หมดอายุ %j → %s", async (card_expire_text, status, date) => {
    const res = await put(idA, form({ card_expire_text }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ card_status: status, card_expire_date: date });
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

// ─── สัญญาราย route ของ /api/customers ───────────────────────────────────────────────────────────────
// ปิดช่องว่างตามรายการบังคับของสกิล api-endpoint ครบทั้ง 5 route: 401 (ไม่มี · ปลอม · หมดอายุ) · 403 ไม่มีสาขาแบบไม่บอกใบ้
// · สาขาถูกปิด · ลูกค้าใช้ร่วมทั้งร้าน · CSRF · validation ชี้ field · audit (R12) · PII (R13)
// database แยกจากชุดบน (startTestApp ของตัวเอง) · ข้อมูลสมมติ: ชื่อขึ้นต้น "ทดสอบ" · เลขบัตรจาก syntheticNationalId() เท่านั้น
// request ที่ถูกปฏิเสธต้อง "ไม่มีผลข้างเคียง": แถวลูกค้า (รวม updated_at) · audit_log ทั้งตาราง · key ใน bucket เท่าเดิม

describe.skipIf(!available)("ลูกค้า — สัญญาราย route: 401 · 403 · สาขา · CSRF · validation · audit · PII", () => {
  type Who = "staff" | "staff2" | "manager" | "accounting" | "admin" | "nobranch" | "closed";
  type Account = Who | "expiring";
  const ACCOUNTS: Record<Account, { role?: Role; branch?: string }> = {
    staff: { branch: "00000" }, // ผู้สร้างลูกค้าหลัก
    staff2: { branch: "00002" }, // อีกสาขา — ลูกค้าใช้ร่วมทั้งร้าน · ผู้แก้ในเทสต์ audit
    manager: { role: "manager", branch: "00000" },
    accounting: { role: "accounting", branch: "00000" },
    admin: { role: "admin", branch: "00000" },
    nobranch: {}, // ยังไม่ผูกสาขา
    closed: { branch: "00001" }, // สาขาเดียวที่มีสิทธิ์จะถูกปิดระหว่างเทสต์
    expiring: { branch: "00000" }, // login 5 session แล้วทำให้หมดอายุ — ไม่มี cookie หลัก
  };
  const ROUTES = ["GET /", "POST /", "GET /:id", "PUT /:id", "GET /:id/photo"] as const;
  type Route = (typeof ROUTES)[number];

  /** 10 ช่องข้อความตามลำดับ Siam ID (ช่องที่ 9 คือรูป ส่งแยก) */
  interface Fields {
    national_id: string;
    name_th: string;
    name_en: string;
    birthday_text: string;
    religion: string;
    address: string;
    card_issue_text: string;
    card_expire_text: string;
    mobile: string;
    phone2: string;
  }
  interface Created {
    id: string;
    nid: string;
    fields: Fields;
  }
  interface Item {
    id: string;
    national_id_masked: string;
    name_th: string;
  }

  let t: TestApp;
  const cookies = {} as Record<Who, string>;
  const userIds = {} as Record<Account, string>;
  /** session แยกกันของผู้ใช้ expiring — หนึ่งอันต่อหนึ่ง route (better-auth ลบ session ที่หมดอายุทิ้งตอนเจอครั้งแรก) */
  let expiringCookies: string[] = [];
  /** เลขบัตรสมมติทุกเลขที่ชุดนี้ส่งเข้าไป — expectNoNationalId ตรวจทั้ง regex และ substring ทุกรูปแบบของเลขเหล่านี้ */
  const knownIds: string[] = [];
  /** ลูกค้าหลัก (มีรูป) สร้างโดย staff สาขา 00000 — เทสต์ส่วนใหญ่แค่อ่าน หรือยืนยันว่ามัน "ไม่เปลี่ยน" */
  let subject: Created;
  /** ลูกค้าสำหรับ F1 — แยกไว้ไม่ให้ it.fails ต้องสร้างข้อมูลเอง (setup พังจะไม่ถูกกลบเป็น "fail ตามคาด") */
  let f1Target: Created;
  /** ลูกค้าที่ถูกแก้เลขบัตรเป็นเลขมาสก์ซ้ำ — setup ของ F2 */
  let sameMaskId = "";

  const nextNationalId = () => {
    const id = syntheticNationalId();
    knownIds.push(id);
    return id;
  };
  /** มาสก์ที่คาดตาม R13 — เขียนจากนิยามตรง ๆ ไม่เรียก maskNationalId ของ core (oracle อิสระ) */
  const masked = (id: string) => `${id.slice(0, 1)} XXXX XXXXX ${id.slice(10, 12)} ${id.slice(12)}`;
  const MASKED_SHAPE = /^\d X{4} X{5} \d{2} \d$/;

  const fieldsFor = (nationalId: string, label: string): Fields => ({
    national_id: nationalId,
    name_th: testName(label),
    name_en: "",
    birthday_text: "01/01/2530",
    religion: "พุทธ",
    address: "99 ถ.ทดสอบ ต.ในเมือง อ.เมือง จ.ขอนแก่น",
    card_issue_text: "01/01/2565",
    card_expire_text: "31/12/2574",
    mobile: "",
    phone2: "",
  });
  function multipart(fields: Fields, photo?: File) {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    if (photo) f.append("photo", photo);
    return f;
  }
  const png = () => new File([PNG], "card.png", { type: "image/png" });
  const jpeg = () => new File([JPEG], "card.jpg", { type: "image/jpeg" });

  async function createCustomer(label: string, photo?: File): Promise<Created> {
    const fields = fieldsFor(nextNationalId(), label);
    const res = await t.request("/api/customers", { cookie: cookies.staff, body: multipart(fields, photo) });
    if (res.status !== 201) throw new Error(`สร้างลูกค้า ${label} ไม่ได้: ${res.status} ${await res.text()}`);
    const { id } = (await res.json()) as { id: string };
    return { id, nid: fields.national_id, fields };
  }
  const put = (id: string, fields: Fields, who: Who, photo?: File) =>
    t.request(`/api/customers/${id}`, { method: "PUT", cookie: cookies[who], body: multipart(fields, photo) });
  const list = (query: string, who: Who = "staff") =>
    t.request(query ? `/api/customers?${query}` : "/api/customers", { cookie: cookies[who] });

  /**
   * ยิง route ด้วย cookie ที่กำหนด · POST/PUT ส่งฟอร์มที่ "ถ้าหลุดผ่าน" จะเขียนจริง (ลูกค้าใหม่ + รูป · แก้เบอร์ + เปลี่ยนรูป)
   * — ตัวกันไหนหลุด sideEffects() เห็นทันที
   */
  function hit(route: Route, cookie: string | undefined, id = subject.id) {
    switch (route) {
      case "GET /":
        return t.request("/api/customers", { cookie });
      case "POST /":
        return t.request("/api/customers", {
          cookie,
          body: multipart(fieldsFor(nextNationalId(), "ห้ามถูกสร้าง"), png()),
        });
      case "GET /:id":
        return t.request(`/api/customers/${id}`, { cookie });
      case "PUT /:id":
        return t.request(`/api/customers/${id}`, {
          method: "PUT",
          cookie,
          body: multipart({ ...subject.fields, mobile: "0800000001" }, jpeg()),
        });
      case "GET /:id/photo":
        return t.request(`/api/customers/${id}/photo`, { cookie });
    }
  }

  /** สิ่งที่ request ที่ถูกปฏิเสธต้องไม่แตะ: แถวลูกค้าทั้งหมด (รวม updated_at) · audit_log ทั้งตาราง · key ใน bucket */
  async function sideEffects() {
    return {
      customers: await t.db.select().from(customer).orderBy(customer.id),
      audit: await t.db.select().from(auditLog).orderBy(auditLog.id),
      keys: t.storage.keys().sort(),
    };
  }

  /** token จริงของ session ที่ยังใช้ได้ + ลายเซ็นรูปแบบถูก (base64 44 ตัว) แต่ไม่ใช่ HMAC ของ token นี้ */
  function forgeSignature(cookie: string) {
    const match = /^([^=;]+)=([^;]+)$/.exec(cookie);
    const signed = decodeURIComponent(match?.[2] ?? "");
    const dot = signed.lastIndexOf(".");
    if (!match || dot < 1 || signed.length - dot - 1 !== 44) {
      throw new Error(`cookie ไม่ใช่รูป token.ลายเซ็น: ${cookie}`);
    }
    const forged = `${match[1]}=${encodeURIComponent(`${signed.slice(0, dot)}.${"A".repeat(43)}=`)}`;
    if (forged === cookie) throw new Error("ลายเซ็นปลอมบังเอิญตรงของจริง");
    return forged;
  }

  beforeAll(async () => {
    t = await startTestApp({ now: () => new Date("2026-09-28T03:00:00Z") });
    const accounts = Object.entries(ACCOUNTS) as [Account, (typeof ACCOUNTS)[Account]][];
    await Promise.all(
      accounts.map(async ([who, a]) => {
        userIds[who] = (await t.createUser({ email: `${who}@ong.test`, password: PW, ...a })).id;
        if (who === "expiring") {
          expiringCookies = await Promise.all(ROUTES.map(() => t.login(`${who}@ong.test`, PW)));
        } else {
          cookies[who] = await t.login(`${who}@ong.test`, PW);
        }
      }),
    );
    subject = await createCustomer("ลูกค้าหลัก สัญญา API", png());
    f1Target = await createCustomer("ลูกค้า F1");
  });
  afterAll(async () => {
    await t?.close();
  });

  // ── 401 ─────────────────────────────────────────────────────────────────────────────────────────────

  it.each([
    { label: "ไม่มี cookie", cookie: () => undefined },
    { label: "cookie ปลอม (token + ลายเซ็นผิดรูป)", cookie: () => "better-auth.session_token=forged.signature" },
    { label: "token จริงแต่ลายเซ็น HMAC ปลอม", cookie: () => forgeSignature(cookies.staff) },
  ])("401 ครบ 5 route เมื่อ$label · error = unauthorized · ไม่มีผลข้างเคียง", async ({ label, cookie }) => {
    const before = await sideEffects();
    for (const route of ROUTES) {
      const body = await expectApiError(await hit(route, cookie()), 401, `${route} (${label})`);
      expect(body.error).toBe("unauthorized");
    }
    expect(await sideEffects()).toEqual(before);
  });

  it("401 ครบ 5 route เมื่อ session หมดอายุ (แต่ละ route ใช้ session ของตัวเอง) · ไม่มีผลข้างเคียง", async () => {
    expect(expiringCookies).toHaveLength(ROUTES.length);
    for (const cookie of expiringCookies) {
      expect((await hit("GET /", cookie)).status, "เงื่อนไขตั้งต้น: session ยังใช้ได้").toBe(200);
    }
    await t.db
      .update(session)
      .set({ expiresAt: new Date("2000-01-01T00:00:00Z") })
      .where(eq(session.userId, userIds.expiring));
    const before = await sideEffects();
    for (const [i, route] of ROUTES.entries()) {
      const body = await expectApiError(await hit(route, expiringCookies[i]), 401, `${route} (session หมดอายุ)`);
      expect(body.error).toBe("unauthorized");
    }
    expect(await sideEffects()).toEqual(before);
  });

  // ── 403 · สาขา fail-closed ──────────────────────────────────────────────────────────────────────────

  it("ไม่มีสิทธิ์สาขา: GET/PUT /:id และ /:id/photo ตอบ 403 เหมือนกันทุกไบต์ ไม่ว่าลูกค้ามีจริง ไม่มีอยู่ หรือ id ผิดรูป (ไม่มี existence oracle · API1:2023)", async () => {
    const before = await sideEffects();
    for (const route of ["GET /:id", "PUT /:id", "GET /:id/photo"] as const) {
      const answers: { status: number; type: string | null; body: string }[] = [];
      for (const id of [subject.id, crypto.randomUUID(), "not-a-uuid"]) {
        const res = await hit(route, cookies.nobranch, id);
        answers.push({ status: res.status, type: res.headers.get("content-type"), body: await res.text() });
      }
      expect(answers[0], `${route}: ลูกค้าที่มีจริง`).toEqual({
        status: 403,
        type: expect.stringMatching(/^application\/json\b/) as unknown,
        body: JSON.stringify({ error: "forbidden" }),
      });
      expect(answers[1], `${route}: uuid ที่ไม่มีอยู่ต้องตอบเหมือนกัน`).toEqual(answers[0]);
      expect(answers[2], `${route}: id ผิดรูปต้องตอบเหมือนกัน`).toEqual(answers[0]);
    }
    expect(await sideEffects()).toEqual(before);
  });

  it("สาขาเดียวที่มีสิทธิ์ถูกปิด = 403 ครบ 5 route ทันทีใน session เดิม · ไม่มีผลข้างเคียง · เปิดคืนแล้วอ่านได้", async () => {
    const before = await sideEffects();
    await t.db.update(branch).set({ isActive: false }).where(eq(branch.code, "00001"));
    try {
      for (const route of ROUTES) {
        const body = await expectApiError(await hit(route, cookies.closed), 403, `${route} (สาขาปิด)`);
        expect(body.error).toBe("forbidden");
      }
    } finally {
      await t.db.update(branch).set({ isActive: true }).where(eq(branch.code, "00001"));
    }
    expect(await sideEffects()).toEqual(before);
    expect((await hit("GET /:id", cookies.closed)).status).toBe(200);
  });

  it("ลูกค้าใช้ร่วมทั้งร้านโดยตั้งใจ — ไม่ scope ตามสาขา (spec §4: customer ไม่มี branch_id): staff สาขา 00002 ค้นเจอ เปิดดู และเห็นรูปของลูกค้าที่ staff สาขา 00000 เพิ่ม", async () => {
    const found = await list(new URLSearchParams({ q: subject.fields.name_th }).toString(), "staff2");
    expect(found.status).toBe(200);
    const { items } = (await found.json()) as { items: Item[] };
    expect(items).toContainEqual(expect.objectContaining({ id: subject.id, national_id_masked: masked(subject.nid) }));

    const detail = await hit("GET /:id", cookies.staff2);
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { national_id: string }).national_id).toBe(subject.nid);
    expect((await hit("GET /:id/photo", cookies.staff2)).status).toBe(200);
  });

  it.each(["staff", "manager", "accounting", "admin"] as const)(
    "role %s ที่มีสาขาเปิดรายการลูกค้าได้ (spec §14.2: หน้าลูกค้า = ทุก role)",
    async (role) => {
      const res = await list("", role);
      expect(res.status).toBe(200);
      const { items } = (await res.json()) as { items: Item[] };
      expect(items.map((i) => i.id)).toContain(subject.id);
    },
  );

  // ── CSRF ────────────────────────────────────────────────────────────────────────────────────────────

  it.each(["https://evil.test", "http://localhost:8787.evil.test", "https://localhost:8787", "http://localhost:8788"])(
    "CSRF: PUT จาก Origin %s = 403 · แถวเดิม · audit · bucket ไม่เปลี่ยน",
    async (origin) => {
      const before = await sideEffects();
      const res = await t.request(`/api/customers/${subject.id}`, {
        method: "PUT",
        cookie: cookies.staff,
        origin,
        body: multipart({ ...subject.fields, mobile: "0800000002" }, jpeg()),
      });
      expect((await expectApiError(res, 403, `PUT Origin ${origin}`)).error).toBe("forbidden origin");
      expect(await sideEffects()).toEqual(before);
    },
  );

  it.each([
    { label: "ไม่มี Origin header", origin: undefined },
    { label: "Origin: null (RFC 6454)", origin: "null" },
  ])("CSRF: $label → POST และ PUT = 403 · ไม่มีผลข้างเคียง", async ({ label, origin }) => {
    const before = await sideEffects();
    const attempts = [
      ["POST", "/api/customers", multipart(fieldsFor(nextNationalId(), "ห้ามถูกสร้าง"), png())],
      ["PUT", `/api/customers/${subject.id}`, multipart({ ...subject.fields, mobile: "0800000003" }, jpeg())],
    ] as const;
    for (const [method, path, body] of attempts) {
      const headers: Record<string, string> = { cookie: cookies.staff };
      if (origin !== undefined) headers.origin = origin;
      const res = await t.app.request(path, { method, headers, body });
      expect((await expectApiError(res, 403, `${method} ${label}`)).error).toBe("forbidden origin");
    }
    expect(await sideEffects()).toEqual(before);
  });

  // ── validation ชี้ field ────────────────────────────────────────────────────────────────────────────

  const TOO_LONG_NAME = testName("").padEnd(201, "ก");
  const INVALID: { label: string; patch: Partial<Fields>; field: keyof Fields }[] = [
    { label: "name_th ยาว 201 ตัว", patch: { name_th: TOO_LONG_NAME }, field: "name_th" },
    { label: "mobile ยาว 31 ตัว", patch: { mobile: "0".repeat(31) }, field: "mobile" },
    { label: "birthday_text ยาว 51 ตัว", patch: { birthday_text: "1".repeat(51) }, field: "birthday_text" },
    {
      label: "national_id มีตัวอักษร",
      patch: { national_id: `${syntheticNationalId().slice(0, 10)}ABC` },
      field: "national_id",
    },
  ];

  it.each(INVALID.flatMap((c) => [{ method: "POST", ...c } as const, { method: "PUT", ...c } as const]))(
    "validation $method: $label → 400 ชี้ช่อง $field · ไม่มีอะไรถูกบันทึก",
    async ({ method, label, patch, field }) => {
      const before = await sideEffects();
      const res =
        method === "POST"
          ? await t.request("/api/customers", {
              cookie: cookies.staff,
              body: multipart({ ...fieldsFor(nextNationalId(), "validation"), ...patch }),
            })
          : await put(subject.id, { ...subject.fields, ...patch }, "staff");
      expect((await expectApiError(res, 400, `${method} ${label}`)).field).toBe(field);
      expect(await sideEffects()).toEqual(before);
    },
  );

  it("validation PUT: ไฟล์ที่ไม่ใช่รูป (ตรวจจาก byte ไม่เชื่อชื่อ/ชนิด) → 400 ชี้ช่อง photo · key ใน bucket และแถวเดิมไม่เปลี่ยน", async () => {
    const before = await sideEffects();
    const notImage = new File([new TextEncoder().encode("%PDF-1.7 ทดสอบ")], "card.png", { type: "image/png" });
    const res = await put(subject.id, { ...subject.fields, mobile: "0800000004" }, "staff", notImage);
    expect((await expectApiError(res, 400, "PUT photo ไม่ใช่รูป")).field).toBe("photo");
    expect(await sideEffects()).toEqual(before);
  });

  it.each([
    { label: "q ยาว 101 ตัว", query: new URLSearchParams({ q: "ก".repeat(101) }).toString(), field: "q" },
    { label: "page=abc", query: "page=abc", field: "page" },
    { label: "page=10001", query: "page=10001", field: "page" },
  ])("validation GET ?$label → 400 ชี้ช่อง $field", async ({ label, query, field }) => {
    expect((await expectApiError(await list(query), 400, `GET ${label}`)).field).toBe(field);
  });

  it("ค่าที่ขอบพอดียังผ่าน (boundary value): q 100 ตัว · page=10000 · name_th 200 · mobile 30 · birthday_text 50", async () => {
    expect((await list(new URLSearchParams({ q: "ก".repeat(100) }).toString())).status).toBe(200);
    const last = await list("page=10000");
    expect(last.status).toBe(200);
    expect(await last.json()).toEqual({ items: [], page: 10000, has_more: false });

    const c = await createCustomer("ขอบ");
    const atLimit = { name_th: testName("").padEnd(200, "ก"), mobile: "0".repeat(30), birthday_text: "1".repeat(50) };
    expect((await put(c.id, { ...c.fields, ...atLimit }, "staff")).status).toBe(200);
    const [row] = await t.db.select().from(customer).where(eq(customer.id, c.id));
    expect(row).toMatchObject({ nameTh: atLimit.name_th, mobile: atLimit.mobile, birthdayText: atLimit.birthday_text });
  });

  it("mass assignment (API3:2023): ช่องนอก 10 ช่อง (id · photo_key · created_by · updated_by) ถูกทิ้งทั้ง POST และ PUT", async () => {
    const forced = {
      id: crypto.randomUUID(),
      photo_key: `photos/${subject.id}/stolen.png`,
      created_by: userIds.admin,
      updated_by: userIds.admin,
    };
    const withForced = (fields: Fields) => {
      const form = multipart(fields);
      for (const [k, v] of Object.entries(forced)) form.append(k, v);
      return form;
    };
    const fields = fieldsFor(nextNationalId(), "mass assignment");
    const created = await t.request("/api/customers", { cookie: cookies.staff, body: withForced(fields) });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(id).not.toBe(forced.id);

    const edited = await t.request(`/api/customers/${id}`, {
      method: "PUT",
      cookie: cookies.staff2,
      body: withForced({ ...fields, mobile: "0800000006" }),
    });
    expect(edited.status).toBe(200);
    const [row] = await t.db.select().from(customer).where(eq(customer.id, id));
    expect(row).toMatchObject({
      mobile: "0800000006",
      photoKey: null,
      createdBy: userIds.staff,
      updatedBy: userIds.staff2,
    });
  });

  // ── audit (R12 · PDPA) ─────────────────────────────────────────────────────────────────────────────

  it("audit (R12): เพิ่มลูกค้า = customer.create 1 แถว · user_id คือผู้สร้าง · เลขบัตรในบันทึกมาสก์", async () => {
    const c = await createCustomer("audit เพิ่ม");
    const rows = await t.db.select().from(auditLog).where(eq(auditLog.rowId, c.id));
    expect(rows).toEqual([
      expect.objectContaining({ action: "customer.create", tableName: "customer", rowId: c.id, userId: userIds.staff }),
    ]);
    expect(rows[0]?.diff).toMatchObject({ after: { national_id: masked(c.nid), name_th: c.fields.name_th } });
  });

  it("audit (R12): แก้เลขบัตร = customer.update 1 แถว · diff มาสก์ทั้งก่อน/หลัง · user_id คือผู้แก้ (staff อีกสาขา)", async () => {
    const c = await createCustomer("audit แก้เลข");
    const newId = nextNationalId();
    expect(masked(newId), "เงื่อนไขตั้งต้น: มาสก์ของเลขใหม่ต้องต่างจากเลขเดิม").not.toBe(masked(c.nid));
    expect((await put(c.id, { ...c.fields, national_id: newId }, "staff2")).status).toBe(200);
    const updates = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.rowId, c.id), eq(auditLog.action, "customer.update")));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ tableName: "customer", userId: userIds.staff2 });
    expect(updates[0]?.diff).toEqual({ national_id: { before: masked(c.nid), after: masked(newId) } });
  });

  it("แก้เลขบัตรเป็นเลขอื่นที่มาสก์ออกมาเหมือนเดิม (ช่องอื่นเท่าเดิม) → 200 · เลขในฐานข้อมูลเปลี่ยนจริง (setup ของ F2)", async () => {
    const c = await createCustomer("audit มาสก์ซ้ำ");
    const other = syntheticSameMask(c.nid);
    knownIds.push(other);
    expect(masked(other), "เงื่อนไขตั้งต้น: มาสก์ต้องเหมือนกัน").toBe(masked(c.nid));
    expect((await put(c.id, { ...c.fields, national_id: other }, "staff2")).status).toBe(200);
    const [row] = await t.db.select().from(customer).where(eq(customer.id, c.id));
    expect(row?.nationalId).toBe(other);
    sameMaskId = c.id;
  });

  // F2 — ต้นเหตุ: apps/api/src/services/customers.ts:221–227 updateCustomer หา "ช่องที่เปลี่ยน" จากผลของ auditView()
  // ซึ่งมาสก์เลขบัตรไปแล้ว (:164) → เลขใหม่ที่มาสก์ออกมาเหมือนเลขเดิม (หลักแรก + 3 หลักท้ายตรงกัน) เทียบแล้ว "ไม่เปลี่ยน"
  // → :228 ข้ามการ insert audit ทั้งแถว: เปลี่ยนตัวตนลูกค้าได้โดยไม่มีร่องรอย (R12 · repudiation · ASVS 4.0.3 V7.1.4)
  // ทางแก้: หา change set จากค่าดิบ (before.nationalId !== row.nationalId ฯลฯ) แล้วค่อยมาสก์ตอนเขียน diff เช่น
  // { national_id: { before: "1 XXXX XXXXX 12 3", after: "1 XXXX XXXXX 12 3", changed: true } } — ห้ามเก็บเลขเต็ม (PDPA)
  // แก้แล้วเทสต์นี้จะแดง → เปลี่ยนเป็น it(...) ธรรมดา · setup อยู่ในเทสต์ก่อนหน้า (ต้องเขียว) เพื่อไม่ให้ setup พังถูกกลบ
  it.fails("F2 — แก้เลขบัตรต้องลง audit เสมอ แม้เลขใหม่มาสก์ออกมาเหมือนเลขเดิม (R12 · ASVS V7.1.4)", async () => {
    const updates = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.rowId, sameMaskId), eq(auditLog.action, "customer.update")));
    expect(updates).toHaveLength(1);
    expect(updates[0]?.userId).toBe(userIds.staff2);
    // รูปแบบ diff ให้คนแก้เลือกเอง (before/after ที่มาสก์ + changed · หรือ national_id_changed) — ขอแค่มีร่องรอยเลขบัตร
    expect(JSON.stringify(updates[0]?.diff)).toContain("national_id");
  });

  // ── PII (R13 · CLAUDE.md กฎ 7) ──────────────────────────────────────────────────────────────────────

  it.each([
    { label: "รายการ (ไม่มี q)", q: () => "" },
    { label: "ค้นชื่อ", q: () => subject.fields.name_th },
    { label: "ค้นเลขบัตรบางส่วน 6 หลัก", q: () => subject.nid.slice(6, 12) },
    { label: "ค้นเลขบัตรเต็มแบบติดกัน", q: () => subject.nid },
    { label: "ค้นเลขบัตรเต็มแบบเว้นวรรค", q: () => cardFormat(subject.nid, " ") },
    { label: "ค้นเลขบัตรเต็มแบบขีด", q: () => cardFormat(subject.nid, "-") },
  ])("PII (R13): $label → เจอลูกค้า · เลขบัตรมาสก์ · ไม่มีเลขเต็มใน response", async ({ label, q }) => {
    const res = await list(q() ? new URLSearchParams({ q: q() }).toString() : "");
    expect(res.status).toBe(200);
    const text = await res.text();
    expectNoNationalId(text, `GET /api/customers ${label}`, knownIds);
    const { items } = JSON.parse(text) as { items: Item[] };
    expect(items).toContainEqual(
      expect.objectContaining({
        id: subject.id,
        name_th: subject.fields.name_th,
        national_id_masked: masked(subject.nid),
      }),
    );
    for (const item of items) expect(item.national_id_masked).toMatch(MASKED_SHAPE);
  });

  it("PII (R13): body ของ POST 201 · 409 เลขซ้ำ · 400 ไม่มีเลขบัตรเต็ม", async () => {
    const fields = fieldsFor(nextNationalId(), "PII ฟอร์ม");
    const created = await t.request("/api/customers", { cookie: cookies.staff, body: multipart(fields) });
    expect(created.status).toBe(201);
    expectNoNationalId(await created.text(), "POST 201", knownIds);

    const dup = await t.request("/api/customers", {
      cookie: cookies.staff,
      body: multipart(fieldsFor(cardFormat(fields.national_id, "-"), "PII เลขซ้ำ")),
    });
    const dupBody = await expectApiError(dup, 409, "POST เลขซ้ำ");
    expect(dupBody.field).toBe("national_id");
    expectNoNationalId(JSON.stringify(dupBody), "POST 409", knownIds);

    const id = fields.national_id;
    const wrongCheckDigit = `${id.slice(0, 12)}${(Number(id.slice(12)) + 1) % 10}`;
    const rejected: [string, Partial<Fields>][] = [
      ["เลขบัตร checksum ผิด", { national_id: wrongCheckDigit }],
      ["ชื่อยาวเกิน (เลขบัตรถูกต้อง)", { national_id: nextNationalId(), name_th: TOO_LONG_NAME }],
    ];
    for (const [label, patch] of rejected) {
      const res = await t.request("/api/customers", {
        cookie: cookies.staff,
        body: multipart({ ...fieldsFor("", "PII 400"), ...patch }),
      });
      const body = await expectApiError(res, 400, `POST ${label}`);
      expectNoNationalId(JSON.stringify(body), `POST 400 ${label}`, [...knownIds, wrongCheckDigit]);
    }
  });

  it("PII (R13): GET /:id เป็นที่เดียวที่มีเลขบัตรเต็ม — มีแค่เลขของลูกค้าคนนั้น · Cache-Control: no-store", async () => {
    const res = await hit("GET /:id", cookies.staff);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(nationalIdsIn(text)).toEqual([subject.nid]);
    expect((JSON.parse(text) as { national_id: string }).national_id).toBe(subject.nid);
  });

  // F1 — ต้นเหตุ: apps/api/src/routes/customers.ts:86 PUT ตอบ c.json(toDetail(row, …)) และ toDetail
  // (apps/api/src/services/customers.ts:58–77) ใส่ national_id: row.nationalId เต็ม 13 หลัก (:61) — ขัด spec §5
  // ("national_id เต็มส่งเฉพาะ GET /customers/{id}") · CLAUDE.md กฎ 7 · R13 · OWASP API3:2023 (excessive data exposure)
  // (ต่างจาก GET /:id ตรงที่ไม่มี Cache-Control: no-store ด้วย แม้ RFC 9110 §9.3.4 จะไม่ให้ cache response ของ PUT)
  // ทางแก้: PUT ตอบ view ที่ไม่มีเลขเต็ม — เช่น {id} หรือรายละเอียดที่ใช้ national_id_masked — แล้วหน้าเว็บ refetch GET /:id
  // แก้แล้วเทสต์นี้จะแดง → เปลี่ยนเป็น it(...) ธรรมดา
  it.fails(
    "F1 — PUT /:id ต้องไม่ส่งเลขบัตรเต็มกลับ (spec §5: เลขเต็มส่งเฉพาะ GET /customers/{id} · CLAUDE.md กฎ 7)",
    async () => {
      const res = await put(f1Target.id, { ...f1Target.fields, mobile: "0800000005" }, "staff");
      expectNoNationalId(await res.text(), "PUT /api/customers/:id", knownIds);
    },
  );

  // อยู่ท้ายสุดโดยตั้งใจ — สแกนทุกแถวที่ทั้งชุดเขียน (รวม setup ของ F1/F2) · เขียนแถวแก้เลขบัตรของตัวเองก่อน ให้มีของตรวจแน่ ๆ
  it("audit_log ทั้งตารางไม่มีเลขบัตรเต็มเลยแม้แต่แถวเดียว (R12 · PDPA · CLAUDE.md กฎ 7)", async () => {
    const c = await createCustomer("audit สแกนทั้งตาราง");
    const edit = { ...c.fields, national_id: nextNationalId(), mobile: "0800000007" };
    expect((await put(c.id, edit, "staff")).status).toBe(200);
    const rows = await t.db.select().from(auditLog);
    expect(rows.map((r) => [r.action, r.rowId])).toContainEqual(["customer.update", c.id]);
    expectNoNationalId(JSON.stringify(rows), "audit_log ทั้งตาราง", knownIds);
  });
});

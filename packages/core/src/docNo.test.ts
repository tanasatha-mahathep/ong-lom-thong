import { describe, expect, it } from "vitest";
import { businessDate } from "./businessDate";
import { docPeriod, formatDocNo } from "./docNo";

// เลขที่เอกสาร R9: RC<yy><mm>-NNNN — yy = 2 หลักท้ายของปี พ.ศ. (ค.ศ. + 543) · mm = เดือน · NNNN = running อย่างน้อย 4 หลัก
// ค่าที่คาดทุกตัวคิดมือจากสเปก + Django DocumentNumber.ym_of: f"{(ปี ค.ศ. + 543) % 100:02d}{เดือน:02d}" · running :04d

// ข้อความ error ตรงตัวของ docNo.ts
const SEQ_ERROR = "running number ต้องเป็นจำนวนเต็ม ≥ 1";
const dateError = (input: string) => `วันที่ต้องเป็น YYYY-MM-DD: ${input}`;

/**
 * ต้องโยน RangeError ด้วยข้อความตรงตัว — toThrow(RangeError) เช็ก instanceof ·
 * toThrow(new RangeError(ข้อความ)) ของ vitest 4 เทียบ name + message แบบเท่ากันทุกตัวอักษร (ไม่ใช่ substring)
 */
function expectRangeError(fn: () => unknown, message: string): void {
  expect(fn).toThrow(RangeError);
  expect(fn).toThrow(new RangeError(message));
}

describe("formatDocNo — RC<ปีพ.ศ.2หลัก><เดือน>-<running 4 หลัก>", () => {
  it("1 ต.ค. 2569 ใบแรก → RC6910-0001", () => {
    expect(formatDocNo("RC", "2026-10-01", 1)).toBe("RC6910-0001");
  });
  it("ก.ย. 2569 ใบที่ 85 → RC6909-0085 (เดือนที่สำรวจมี RC 85 ใบ)", () => {
    expect(formatDocNo("RC", "2026-09-27", 85)).toBe("RC6909-0085");
  });
  it("ข้ามปี พ.ศ. 2570 → 7001", () => {
    expect(docPeriod("2027-01-15")).toBe("7001");
  });
  it("เกิน 9999 ใบ/เดือน ยังไม่ชน (5 หลัก)", () => {
    expect(formatDocNo("RC", "2026-10-01", 10000)).toBe("RC6910-10000");
  });
  it.each([0, -1, 1.5])("running %j ไม่ถูกต้อง", (n) => {
    expectRangeError(() => formatDocNo("RC", "2026-10-01", n), SEQ_ERROR);
  });
  it.each(["2026-1-1", "01/10/2026", ""])("วันที่ %j ไม่ใช่ ISO", (d) => {
    expectRangeError(() => docPeriod(d), dateError(d));
  });
});

// ---------- docPeriod: ค่าที่รับ ----------

describe("docPeriod — เดือนผ่านไปตามที่พิมพ์ ครบ 12 เดือน (EP: ทุกค่าของโดเมนเดือน)", () => {
  // 2026 + 543 = 2569 → "69" · วันที่ 15 อยู่กลางเดือน ห่างจากรอยต่อ ผลที่ต่างกันจึงมาจากเดือนอย่างเดียว
  it.each([
    ["2026-01-15", "6901"],
    ["2026-02-15", "6902"],
    ["2026-03-15", "6903"],
    ["2026-04-15", "6904"],
    ["2026-05-15", "6905"],
    ["2026-06-15", "6906"],
    ["2026-07-15", "6907"],
    ["2026-08-15", "6908"],
    ["2026-09-15", "6909"],
    ["2026-10-15", "6910"],
    ["2026-11-15", "6911"],
    ["2026-12-15", "6912"],
  ])("%s → %s", (isoDate, period) => {
    expect(docPeriod(isoDate)).toBe(period);
  });
});

describe("docPeriod — รอยต่อเดือนและปี (BVA: วันสุดท้ายของงวด | วันแรกของงวดถัดไป)", () => {
  it.each([
    ["2026-09-30", "6909"], // วันสุดท้ายของ ก.ย. 2569
    ["2026-10-01", "6910"], // วันแรกของ ต.ค. 2569 — งวดแรกที่ขึ้นระบบ (RC6910-0001)
    ["2026-12-31", "6912"], // วันสุดท้ายของปี พ.ศ. 2569
    ["2027-01-01", "7001"], // วันแรกของปี พ.ศ. 2570 (2027 + 543)
  ])("%s → %s", (isoDate, period) => {
    expect(docPeriod(isoDate)).toBe(period);
  });
});

describe("docPeriod — yy = ปี พ.ศ. % 100: ข้ามศตวรรษ พ.ศ. และการเติม 0 (BVA)", () => {
  it.each([
    ["2056-12-31", "9912"], // 2056 + 543 = 2599 → 99 ค่าสูงสุดของ 2 หลัก
    ["2057-01-01", "0001"], // 2057 + 543 = 2600 → 2600 % 100 = 0 ต้องเป็น "00" ไม่ใช่ "0"
    ["2066-12-31", "0912"], // 2066 + 543 = 2609 → 9 → "09" ตัวสุดท้ายที่ต้องเติม 0
    ["2067-01-01", "1001"], // 2067 + 543 = 2610 → 10 ตัวแรกที่ครบ 2 หลักเอง
  ])("%s → %s", (isoDate, period) => {
    expect(docPeriod(isoDate)).toBe(period);
  });
});

describe("docPeriod — ฟังก์ชันบริสุทธิ์", () => {
  it("เรียกซ้ำ สลับค่า และหลังเจอ error ก็ได้ผลเดิม — regex ไม่พก state (lastIndex) ข้ามการเรียก", () => {
    expect(docPeriod("2026-10-01")).toBe("6910");
    expect(docPeriod("2026-10-01")).toBe("6910");
    expect(docPeriod("2027-01-15")).toBe("7001");
    expect(() => docPeriod("2026-10-01T00:00:00Z")).toThrow(RangeError);
    expect(docPeriod("2026-10-01")).toBe("6910");
  });
});

describe("งวดของบิลตามวันเวลาไทย — businessDate() → docPeriod()", () => {
  // เซิร์ฟเวอร์รัน UTC แต่วันทำการคือเวลาไทย (UTC+7 ไม่มี DST) — บิลหลังเที่ยงคืนไทยขึ้นงวดใหม่ แม้ UTC ยังเป็นวันเก่า
  it.each([
    ["2026-09-30T16:59:59Z", "6909"], // 23:59:59 ไทย 30 ก.ย. → ยังงวด ก.ย.
    ["2026-09-30T17:00:00Z", "6910"], // 00:00 ไทย 1 ต.ค. (UTC ยัง 30 ก.ย.) → งวด ต.ค.
    ["2026-12-31T17:00:00Z", "7001"], // 00:00 ไทย 1 ม.ค. 2570 (UTC ยัง 31 ธ.ค.) → ขึ้นปี พ.ศ. ใหม่
  ])("%s → %s", (instant, period) => {
    expect(docPeriod(businessDate(new Date(instant)))).toBe(period);
  });
});

// ---------- docPeriod: ค่าที่ต้องปฏิเสธ ----------

describe("docPeriod — ไม่ใช่ YYYY-MM-DD ตรงตัว → RangeError พร้อมค่าที่ส่งมา (EP + BVA + error guessing)", () => {
  it.each([
    // BVA ความยาวทีละช่อง: ปี 4 · เดือน 2 · วัน 2 หลักพอดี
    ["26-10-01", "ปี 2 หลัก"],
    ["026-10-01", "ปี 3 หลัก"],
    ["12026-10-01", "ปี 5 หลัก"],
    ["2026-1-01", "เดือน 1 หลัก"],
    ["2026-010-01", "เดือน 3 หลัก"],
    ["2026-10-1", "วัน 1 หลัก"],
    ["2026-10-001", "วัน 3 หลัก"],
    ["2026-10", "ไม่มีวัน (ค่าจาก input type=month)"],
    // ตัวคั่น
    ["2026/10/01", "คั่นด้วย /"],
    ["2026–10–01", "en dash (U+2013) หน้าตาเหมือนขีด"],
    ["20261001", "ISO แบบ basic ไม่มีขีด"],
    // ช่องว่าง — ไม่ trim ให้
    [" ", "ช่องว่างล้วน"],
    [" 2026-10-01", "ช่องว่างนำหน้า"],
    ["2026-10-01 ", "ช่องว่างต่อท้าย"],
    ["2026-10-01\n", "ขึ้นบรรทัดท้าย (regex ของ JS ไม่ยอม ต่างจาก Python)"],
    // มีของต่อท้าย · ตัวเลขไม่ใช่ ASCII · ขยะ
    ["2026-10-01T00:00:00Z", "มีเวลาต่อท้าย (ISO datetime)"],
    ["๒๕๖๙-๑๐-๐๑", "เลขไทย"],
    ["yyyy-mm-dd", "placeholder ที่ยังไม่กรอก"],
  ])("%j — %s", (input) => {
    expectRangeError(() => docPeriod(input), dateError(input));
  });

  it.each<[undefined | null, string]>([
    [undefined, "วันที่ต้องเป็น YYYY-MM-DD: undefined"],
    [null, "วันที่ต้องเป็น YYYY-MM-DD: null"],
  ])("%j จากโค้ด JS ที่ไม่มี type → RangeError ไม่ใช่ TypeError", (input, message) => {
    expectRangeError(() => docPeriod(input as unknown as string), message);
  });
});

// ---------- formatDocNo ----------

describe("formatDocNo — running เติม 0 ให้ครบ 4 หลัก เกินแล้วขยาย ไม่ตัด (BVA ทุกรอยต่อจำนวนหลัก)", () => {
  it.each([
    [1, "RC6910-0001"], // ขอบล่าง: ใบแรกของงวด
    [2, "RC6910-0002"], // เหนือขอบล่าง
    [9, "RC6910-0009"], // 1 หลักตัวสุดท้าย
    [10, "RC6910-0010"], // 2 หลักตัวแรก
    [99, "RC6910-0099"],
    [100, "RC6910-0100"],
    [999, "RC6910-0999"],
    [1000, "RC6910-1000"], // 4 หลักพอดี ไม่ต้องเติม
    [9999, "RC6910-9999"], // ตัวสุดท้ายที่พอดี 4 หลัก
    [10000, "RC6910-10000"], // ขยายเป็น 5 หลัก — ถ้าตัดเหลือ 4 หลักจะได้ "1000" ชนกับใบที่ 1000
    [2147483647, "RC6910-2147483647"], // เพดาน integer ของ Postgres (doc_sequence.last_no)
  ])("running %j → %s", (seq, docNo) => {
    expect(formatDocNo("RC", "2026-10-01", seq)).toBe(docNo);
  });
});

describe("formatDocNo — running ที่ไม่ใช่จำนวนเต็ม ≥ 1 → RangeError (EP + BVA + error guessing)", () => {
  // แถว = [ชื่อที่แสดง, ค่า running] — ชื่อแยกจากค่าเพราะ -0 · NaN · 1n แสดงผลตรง ๆ ไม่ได้
  it.each<[string, unknown]>([
    ["-0 (Number.isInteger(-0) เป็นจริง แต่ < 1)", -0],
    ["1 − 2⁻⁵³ (double ที่ติดกับ 1 ด้านล่าง)", 1 - Number.EPSILON / 2],
    ["1 + 2⁻⁵² (double ที่ติดกับ 1 ด้านบน — ≥ 1 แต่ไม่ใช่จำนวนเต็ม)", 1 + Number.EPSILON],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ['string "1" (เช่นเลขที่ driver ส่งมาเป็น string)', "1"],
    ["bigint 1n", 1n],
    ["null (NULL จาก DB)", null],
    ["undefined (ไม่ได้ส่งมา)", undefined],
  ])("%s", (_label, seq) => {
    expectRangeError(() => formatDocNo("RC", "2026-10-01", seq as number), SEQ_ERROR);
  });
});

describe("formatDocNo — prefix ต่อหน้าตามที่ส่งมา ไม่ผูกตายกับ RC", () => {
  // prefix ใน Django DocumentNumber: RC รับซื้อ · RD ไถ่ออก · J ขายฝาก — FIXED 10 ก.ย. 2569 → ym "6909"
  it.each([
    ["RC", "RC6909-0001"],
    ["RD", "RD6909-0001"],
    ["J", "J6909-0001"],
  ])("prefix %j → %s", (prefix, docNo) => {
    expect(formatDocNo(prefix, "2026-09-10", 1)).toBe(docNo);
  });
});

describe("formatDocNo — ตารางตัดสินใจ: running ถูก/ผิด × วันที่ถูก/ผิด", () => {
  it("running ถูก · วันที่ถูก → เลขที่เอกสาร (ใบที่ 2 ของงวด ตรงกับ Django: RC6909-0002)", () => {
    expect(formatDocNo("RC", "2026-09-10", 2)).toBe("RC6909-0002");
  });
  it("running ผิด · วันที่ถูก → RangeError ของ running", () => {
    expectRangeError(() => formatDocNo("RC", "2026-09-10", 0), SEQ_ERROR);
  });
  it("running ถูก · วันที่ผิด → RangeError ของวันที่ส่งต่อมาตรงตัว ไม่ได้เลขที่ครึ่ง ๆ กลาง ๆ", () => {
    expectRangeError(() => formatDocNo("RC", "01/10/2569", 1), dateError("01/10/2569"));
  });
  it("running ผิด · วันที่ผิด → RangeError (สเปกไม่กำหนดว่าข้อความของช่องไหนมาก่อน)", () => {
    expect(() => formatDocNo("RC", "01/10/2569", 0)).toThrow(RangeError);
  });
});

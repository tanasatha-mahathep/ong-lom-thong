import { afterEach, describe, expect, it, vi } from "vitest";
import { businessDate, businessTime, SHOP_TIME_ZONE } from "./businessDate";
import { docPeriod } from "./docNo";

// ค่าที่คาดทุกตัวคิดมือ ไม่ได้รันโค้ดแล้วลอกผล:
// - Asia/Bangkok = UTC+7 ตลอดปี ไม่มี DST → เวลาไทย = UTC + 7 ชม.
// - วันไทย D เริ่ม 17:00:00.000Z ของวันก่อนหน้า และจบ 16:59:59.999Z ของวัน D → รอยต่อวันอยู่ที่ 17:00Z ไม่ใช่ 00:00Z
// - ปีอธิกสุรทิน (เกรกอเรียน): หาร 4 ลงตัว ยกเว้นหาร 100 ลงตัวแต่หาร 400 ไม่ลงตัว → 2028 อธิก · 2027 ปกติ
// - เวลาไทย "HH:MM" = ชั่วโมงและนาทีของ (UTC + 7 ชม.) ตัดวินาทีและ ms ทิ้ง ไม่ปัด · 24 ชม. แบบ h23 = 00–23 ไม่มี 24
// ไม่พึ่งนาฬิกาเครื่อง: เทสต์ที่ไม่ส่ง now ใช้ fake timers · ทุกเทสต์คืนนาฬิกา spy และ env หลังจบ

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("businessDate — วันตามเวลาไทย ไม่ใช่ UTC", () => {
  it.each([
    ["2026-09-27T16:59:59Z", "2026-09-27"], // 23:59:59 ไทย
    ["2026-09-27T17:00:00Z", "2026-09-28"], // เที่ยงคืนไทย
    ["2026-09-27T18:30:00Z", "2026-09-28"], // 01:30 ไทย แต่ UTC ยังเป็นวันที่ 27
    ["2026-12-31T17:00:00Z", "2027-01-01"], // ข้ามปี
    ["2028-02-28T17:00:00Z", "2028-02-29"], // ปีอธิกสุรทิน
  ])("%s → %s", (iso, expected) => {
    expect(businessDate(new Date(iso))).toBe(expected);
  });

  it("เปลี่ยนเขตเวลาได้", () => {
    expect(businessDate(new Date("2026-09-27T18:30:00Z"), "UTC")).toBe("2026-09-27");
  });
});

describe("ค่า default — now = นาฬิกา ณ ตอนเรียก · timeZone = SHOP_TIME_ZONE", () => {
  it("SHOP_TIME_ZONE คือ Asia/Bangkok — ค่านี้เปลี่ยนเมื่อไร วันทำการและงวดเลขที่เอกสารขยับทั้งระบบ", () => {
    expect(SHOP_TIME_ZONE).toBe("Asia/Bangkok");
  });

  // ตารางตัดสินใจ now {ไม่ส่ง · undefined · ส่งมา} × timeZone {ไม่ส่ง · undefined · "UTC"}
  // นาฬิกาปลอมตั้งไว้ในอดีต (ก่อนวันที่เขียนเทสต์) — โค้ดที่เผลออ่านนาฬิกาจริงจะไม่มีวันได้วันที่ตรงโดยบังเอิญ
  // นาฬิกา 2025-06-30T18:30Z = ไทย 01:30 วันที่ 1 ก.ค. 2025 · UTC วันที่ 30 มิ.ย.
  // now ที่ส่งมา 2027-03-15T20:00Z = ไทย 03:00 วันที่ 16 มี.ค. · UTC วันที่ 15 — ผลทั้ง 4 แบบต่างกันหมด กฎไหนผิดก็เห็น
  const CLOCK = "2025-06-30T18:30:00.000Z";
  const NOW = new Date("2027-03-15T20:00:00.000Z");
  it.each<[string, string, () => string]>([
    ["ไม่ส่งทั้งคู่ → นาฬิกา · เวลาไทย", "2025-07-01", () => businessDate()],
    ["undefined ทั้งคู่ → เหมือนไม่ส่ง", "2025-07-01", () => businessDate(undefined, undefined)],
    ["now undefined · UTC → นาฬิกา · UTC", "2025-06-30", () => businessDate(undefined, "UTC")],
    ["ส่ง now · ไม่ส่ง timeZone → now · เวลาไทย (api ส่ง c.var.now())", "2027-03-16", () => businessDate(NOW)],
    ["ส่ง now · timeZone undefined → now · เวลาไทย", "2027-03-16", () => businessDate(NOW, undefined)],
    ["ส่ง now · UTC → now · UTC", "2027-03-15", () => businessDate(NOW, "UTC")],
  ])("%s → %s", (_label, expected, call) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(CLOCK));
    expect(call()).toBe(expected);
  });

  it("อ่านนาฬิกาใหม่ทุกครั้งที่เรียก ไม่ค้างค่าไว้ตอน import — เดินนาฬิกา 1 ms ข้ามเที่ยงคืนไทย", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-30T16:59:59.999Z")); // 23:59:59.999 ไทย 30 มิ.ย. 2025 (อดีต — เหตุผลเดียวกับตาราง)
    expect(businessDate()).toBe("2025-06-30");
    vi.advanceTimersByTime(1); // 17:00:00.000Z = 00:00:00.000 ไทย 1 ก.ค. 2025
    expect(businessDate()).toBe("2025-07-01");
  });
});

describe("เที่ยงคืนไทย (17:00Z) คือรอยต่อวัน ถึงระดับมิลลิวินาที — เที่ยงคืน UTC ไม่ใช่รอยต่อ (BVA 3 จุด)", () => {
  it.each([
    ["2026-09-27T16:59:59.999Z", "2026-09-27"], // 23:59:59.999 ไทย — ต่ำกว่ารอยต่อ 1 ms: ms สุดท้ายของวันที่ 27
    ["2026-09-27T17:00:00.000Z", "2026-09-28"], // 00:00:00.000 ไทย — บนรอยต่อพอดี: ms แรกของวันที่ 28
    ["2026-09-27T17:00:00.001Z", "2026-09-28"], // 00:00:00.001 ไทย — เกินรอยต่อ 1 ms
    ["2026-09-27T23:59:59.999Z", "2026-09-28"], // 06:59:59.999 ไทย — UTC ยังวันที่ 27 (toISOString().slice(0, 10) ได้ 27 ผิด)
    ["2026-09-28T00:00:00.000Z", "2026-09-28"], // 07:00 ไทย — UTC ขึ้นวันที่ 28 แต่วันไทยไม่เปลี่ยน
    ["2026-09-28T16:59:59.999Z", "2026-09-28"], // 23:59:59.999 ไทย — ms สุดท้ายของวันที่ 28
    ["2026-09-28T17:00:00.000Z", "2026-09-29"], // 00:00 ไทย วันที่ 29
  ])("%s → %s", (iso, expected) => {
    expect(businessDate(new Date(iso))).toBe(expected);
  });
});

describe("สิ้นเดือนทุกเดือนของ ค.ศ. 2027 (ปีปกติ) — ms สุดท้ายของเดือน | ms แรกของเดือนถัดไป (EP ความยาวเดือน + BVA 2 จุด)", () => {
  // ครบ 12 เดือน: ตารางความยาวเดือนที่พิมพ์ผิดเดือนเดียวก็จับได้ · แถว 17:00Z คือวันสุดท้ายของเดือนตาม UTC
  // ซึ่ง UTC ยังอยู่เดือนเก่า แต่เวลาไทยขึ้นเดือนใหม่แล้ว (= งวดเลขที่เอกสารใหม่)
  it.each([
    ["2027-01-31T16:59:59.999Z", "2027-01-31"], // ม.ค. 31 วัน
    ["2027-01-31T17:00:00.000Z", "2027-02-01"],
    ["2027-02-28T16:59:59.999Z", "2027-02-28"], // ก.พ. 28 วัน — 2027 หาร 4 ไม่ลงตัว ไม่มี 29 ก.พ.
    ["2027-02-28T17:00:00.000Z", "2027-03-01"],
    ["2027-03-31T16:59:59.999Z", "2027-03-31"], // มี.ค. 31 วัน
    ["2027-03-31T17:00:00.000Z", "2027-04-01"],
    ["2027-04-30T16:59:59.999Z", "2027-04-30"], // เม.ย. 30 วัน
    ["2027-04-30T17:00:00.000Z", "2027-05-01"],
    ["2027-05-31T16:59:59.999Z", "2027-05-31"], // พ.ค. 31 วัน
    ["2027-05-31T17:00:00.000Z", "2027-06-01"],
    ["2027-06-30T16:59:59.999Z", "2027-06-30"], // มิ.ย. 30 วัน
    ["2027-06-30T17:00:00.000Z", "2027-07-01"],
    ["2027-07-31T16:59:59.999Z", "2027-07-31"], // ก.ค. 31 วัน
    ["2027-07-31T17:00:00.000Z", "2027-08-01"],
    ["2027-08-31T16:59:59.999Z", "2027-08-31"], // ส.ค. 31 วัน
    ["2027-08-31T17:00:00.000Z", "2027-09-01"],
    ["2027-09-30T16:59:59.999Z", "2027-09-30"], // ก.ย. 30 วัน
    ["2027-09-30T17:00:00.000Z", "2027-10-01"], // เดือน 09 → 10: เลิกเติม 0
    ["2027-10-31T16:59:59.999Z", "2027-10-31"], // ต.ค. 31 วัน
    ["2027-10-31T17:00:00.000Z", "2027-11-01"],
    ["2027-11-30T16:59:59.999Z", "2027-11-30"], // พ.ย. 30 วัน
    ["2027-11-30T17:00:00.000Z", "2027-12-01"],
    ["2027-12-31T16:59:59.999Z", "2027-12-31"], // ธ.ค. 31 วัน — วันสุดท้ายของปี
    ["2027-12-31T17:00:00.000Z", "2028-01-01"], // ข้ามปี ทั้งที่ UTC ยัง 31 ธ.ค. 2027
  ])("%s → %s", (iso, expected) => {
    expect(businessDate(new Date(iso))).toBe(expected);
  });
});

describe("ปีอธิกสุรทิน ค.ศ. 2028 — 29 ก.พ. มีจริงตามเวลาไทย (BVA)", () => {
  // 2028 หาร 4 ลงตัวและไม่ใช่ปีศตวรรษ → ก.พ. 29 วัน · ปีปกติ (2027-02-28T17:00Z → 2027-03-01) อยู่ในตารางทุกเดือนด้านบน
  it.each([
    ["2028-02-28T16:59:59.999Z", "2028-02-28"], // 23:59:59.999 ไทย 28 ก.พ.
    ["2028-02-28T17:00:00.000Z", "2028-02-29"], // 00:00 ไทย 29 ก.พ. — ไม่ใช่ 1 มี.ค.
    ["2028-02-29T16:59:59.999Z", "2028-02-29"], // 23:59:59.999 ไทย 29 ก.พ.
    ["2028-02-29T17:00:00.000Z", "2028-03-01"], // 00:00 ไทย 1 มี.ค.
  ])("%s → %s", (iso, expected) => {
    expect(businessDate(new Date(iso))).toBe(expected);
  });
});

describe("รูปแบบ YYYY-MM-DD ปี ค.ศ. เลขอารบิก เติม 0 เสมอ", () => {
  // วันไทย 1 ม.ค. 2027 — เดือนและวันหลักเดียวทั้งคู่ · ชั่วโมงไทย h = 2026-12-31T17:00Z + h ชม.
  // ระหว่างวัน (ตอน 07:00 ไทย) UTC ข้ามทั้งวันและปี แต่วันไทยต้องคงที่ทั้ง 24 ชั่วโมง
  it.each(Array.from({ length: 24 }, (_, hour) => hour))(
    "ชั่วโมงที่ %i ไทย ทั้ง ms แรกและ ms สุดท้าย → 2027-01-01",
    (hour) => {
      const start = Date.UTC(2026, 11, 31, 17 + hour); // เดือน 11 = ธ.ค. · Date.UTC ทบชั่วโมงที่เกิน 23 ไปวันถัดไปเอง
      expect(businessDate(new Date(start))).toBe("2027-01-01");
      expect(businessDate(new Date(start + 3_599_999))).toBe("2027-01-01"); // + 1 ชม. − 1 ms
    },
  );

  it.each([
    ["2026-09-09T16:59:59.999Z", "2026-09-09"], // วันหลักเดียวตัวสุดท้าย — เติม 0
    ["2026-09-09T17:00:00.000Z", "2026-09-10"], // วันสองหลักตัวแรก — ไม่เติม
  ])("วันที่ 09 | 10 (BVA จำนวนหลัก): %s → %s", (iso, expected) => {
    expect(businessDate(new Date(iso))).toBe(expected);
  });

  it("ปี ค.ศ. ไม่ใช่ พ.ศ. — docPeriod() บวก 543 เอง ถ้าได้ปี พ.ศ. มาจะบวกซ้ำเป็นงวดผิดโดยไม่มี error", () => {
    const today = businessDate(new Date("2026-09-27T17:00:00.000Z")); // 00:00 ไทย 28 ก.ย. 2569
    expect(today).toBe("2026-09-28"); // ไม่ใช่ "2569-09-28" (ปฏิทินพุทธของ locale th-TH)
    expect(docPeriod(today)).toBe("6909"); // 2026 + 543 = 2569 → "69" · ก.ย. → "09" (ถ้าได้ 2569 มา: 3112 → "1209")
  });
});

describe("เขตเวลาอื่น — instant เดียวกัน ได้วันตามเขตที่ส่งมา (EP: หลัง UTC · UTC · หน้า UTC)", () => {
  // เลือกเวลาท้องถิ่นให้ห่างเที่ยงคืนพอที่ DST ของ New York (EDT −4 หรือ EST −5) ไม่ทำให้วันเปลี่ยน
  // เทสต์จึงผูกกับเขตที่ส่งมา ไม่ผูกกับกฎ DST ใน tzdata
  it.each([
    // 2026-09-28T02:00Z — New York ยังเป็นวันที่ 27
    ["2026-09-28T02:00:00.000Z", "America/New_York", "2026-09-27"], // EDT −4 → 22:00 วันที่ 27 (EST −5 ก็ 21:00 วันเดียวกัน)
    ["2026-09-28T02:00:00.000Z", "UTC", "2026-09-28"], // 02:00
    ["2026-09-28T02:00:00.000Z", "Asia/Bangkok", "2026-09-28"], // +7 → 09:00
    ["2026-09-28T02:00:00.000Z", "Asia/Tokyo", "2026-09-28"], // +9 → 11:00
    // 2026-09-27T16:00Z — โตเกียวขึ้นวันที่ 28 ก่อนไทย
    ["2026-09-27T16:00:00.000Z", "America/New_York", "2026-09-27"], // EDT −4 → 12:00 (EST −5 → 11:00)
    ["2026-09-27T16:00:00.000Z", "UTC", "2026-09-27"], // 16:00
    ["2026-09-27T16:00:00.000Z", "Asia/Bangkok", "2026-09-27"], // +7 → 23:00
    ["2026-09-27T16:00:00.000Z", "Asia/Tokyo", "2026-09-28"], // +9 → 01:00 วันที่ 28
  ])("%s ที่ %s → %s", (iso, timeZone, expected) => {
    expect(businessDate(new Date(iso), timeZone)).toBe(expected);
  });
});

describe("ไม่ขึ้นกับ TZ ของเครื่องที่รัน — เซิร์ฟเวอร์เป็น UTC · เครื่อง dev ในไทยเป็น +7", () => {
  // โค้ดที่พลาดไปใช้เวลาเครื่อง (getDate() · getMonth()) ผ่านทุกเทสต์ด้านบนบนเครื่องที่ตั้งเวลาไทย แต่ผิดบนเซิร์ฟเวอร์ UTC
  // จึงสลับ TZ ของ process ระหว่างเทสต์ (Node อ่าน process.env.TZ ใหม่ทันทีที่ตั้ง · afterEach คืนค่าเดิม)
  // getTimezoneOffset() = UTC − เวลาเครื่อง (นาที) เป็น control ว่าสลับได้จริง ไม่ใช่เทสต์ที่ผ่านเพราะไม่ได้ทดสอบอะไร
  // ทุกเขตไม่มี DST — offset คงที่ทั้งปี
  it.each<[string, number]>([
    ["UTC", 0], // เซิร์ฟเวอร์และ CI
    ["Asia/Bangkok", -420], // +7 — เครื่อง dev ในไทย
    ["Pacific/Honolulu", 600], // −10
    ["Pacific/Kiritimati", -840], // +14 เขตที่เร็วที่สุด — เวลาเครื่องขึ้นวันที่ 28 ก่อนไทย
  ])("TZ=%s → วันไทยเท่าเดิม", (tz, offsetMinutes) => {
    vi.stubEnv("TZ", tz);
    expect(new Date("2026-09-27T17:00:00.000Z").getTimezoneOffset()).toBe(offsetMinutes);
    expect(businessDate(new Date("2026-09-27T16:59:59.999Z"))).toBe("2026-09-27"); // 23:59:59.999 ไทย
    expect(businessDate(new Date("2026-09-27T17:00:00.000Z"))).toBe("2026-09-28"); // 00:00 ไทย
  });
});

describe("ไม่มี state ข้ามการเรียก (error guessing)", () => {
  it("เรียกซ้ำ สลับเขตเวลา และหลังเจอ error ก็ได้ผลเดิม — ไม่ cache formatter ของเขตแรกไว้ใช้กับเขตอื่น", () => {
    const now = new Date("2026-09-27T18:30:00.000Z"); // UTC 18:30 วันที่ 27 = ไทย 01:30 วันที่ 28
    expect(businessDate(now)).toBe("2026-09-28");
    expect(businessDate(now, "UTC")).toBe("2026-09-27");
    expect(businessDate(now)).toBe("2026-09-28");
    expect(() => businessDate(now, "Mars/Olympus")).toThrow(RangeError);
    expect(businessDate(now, "UTC")).toBe("2026-09-27");
    expect(businessDate(now)).toBe("2026-09-28");
  });

  it("ไม่แก้ Date ที่ส่งมา — route ใช้ now ตัวเดียวกันต่อได้ (เช่นถ้าบวก 7 ชม. ด้วย setHours() เวลาจะเพี้ยน)", () => {
    const now = new Date("2026-09-27T17:00:00.000Z");
    expect(businessDate(now)).toBe("2026-09-28");
    expect(businessDate(now, "UTC")).toBe("2026-09-27");
    expect(now.toISOString()).toBe("2026-09-27T17:00:00.000Z");
  });
});

describe("input ผิด → RangeError ไม่คืนวันที่มั่ว (fail-closed · EP + BVA ขอบของ Date)", () => {
  // Date เก็บเวลาได้ ±8.64e15 ms จาก epoch (±100,000,000 วัน) — เกินไป 1 ms = Invalid Date (time value เป็น NaN)
  it.each<[string, Date]>([
    ['new Date("x") — ข้อความที่ parse ไม่ได้', new Date("x")],
    ["new Date(NaN)", new Date(Number.NaN)],
    ["8.64e15 + 1 ms — เกินเพดานบนของ Date 1 ms", new Date(8.64e15 + 1)],
    ["−8.64e15 − 1 ms — ต่ำกว่าพื้นของ Date 1 ms", new Date(-8.64e15 - 1)],
    ['string "2026-09-28" จากโค้ด JS ที่ไม่มี type — แปลงเป็นตัวเลขได้ NaN', "2026-09-28" as unknown as Date],
  ])("now = %s → RangeError", (_label, now) => {
    expect(() => businessDate(now)).toThrow(RangeError);
  });

  it.each<[string, Date]>([
    ["8.64e15 ms — เพดานบนพอดี +275760-09-13T00:00:00.000Z", new Date(8.64e15)],
    ["−8.64e15 ms — พื้นพอดี −271821-04-20T00:00:00.000Z", new Date(-8.64e15)],
  ])("now = %s → ปีไม่ใช่ 4 หลัก ส่งต่อเข้า docPeriod() แล้วต้อง RangeError ไม่ได้งวดมั่ว", (_label, now) => {
    expect(() => docPeriod(businessDate(now))).toThrow(RangeError);
  });

  it.each<[string, string]>([
    ["Mars/Olympus", "ไม่มีในฐานข้อมูลเขตเวลา IANA"],
    ["", "สตริงว่าง เช่น env ที่มีชื่อแต่ไม่มีค่า — ต้องไม่ตกไปใช้ Asia/Bangkok หรือ UTC เงียบ ๆ"],
    ["Asia/Bangkok ", "มีเว้นวรรคท้าย — ค่า config ที่ไม่ได้ trim"],
  ])("timeZone %j (%s) → RangeError", (timeZone) => {
    expect(() => businessDate(new Date("2026-09-27T17:00:00.000Z"), timeZone)).toThrow(RangeError);
  });

  it("timeZone null จากโค้ด JS ที่ไม่มี type → RangeError ไม่ใช่ค่า default (default ใช้เฉพาะ undefined)", () => {
    expect(() => businessDate(new Date("2026-09-27T17:00:00.000Z"), null as unknown as string)).toThrow(RangeError);
  });
});

describe("fault injection — Intl.DateTimeFormat คืนชิ้นส่วนผิดรูป (ICU จริงไม่เกิด จึงจำลองด้วย spy)", () => {
  // ชิ้นส่วนที่ en-CA ควรคืนสำหรับ 00:00 ไทย 28 ก.ย. 2026
  const NOW = new Date("2026-09-27T17:00:00.000Z");
  const YEAR: Intl.DateTimeFormatPart = { type: "year", value: "2026" };
  const MONTH: Intl.DateTimeFormatPart = { type: "month", value: "09" };
  const DAY: Intl.DateTimeFormatPart = { type: "day", value: "28" };
  const DASH: Intl.DateTimeFormatPart = { type: "literal", value: "-" };
  const SLASH: Intl.DateTimeFormatPart = { type: "literal", value: "/" };

  const injectParts = (parts: Intl.DateTimeFormatPart[]) =>
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockReturnValue(parts);

  it.each<[string, Intl.DateTimeFormatPart[]]>([
    ["ครบตามลำดับ en-CA (control ว่า spy ถูกเรียกจริง)", [YEAR, DASH, MONTH, DASH, DAY]],
    ["ลำดับ เดือน/วัน/ปี คั่นด้วย / (ถ้า CLDR เปลี่ยน pattern ของ en-CA)", [MONTH, SLASH, DAY, SLASH, YEAR]],
  ])("%s → ยังได้ 2026-09-28 เพราะหยิบตามชนิดชิ้นส่วน ไม่ใช่ตามตำแหน่ง", (_label, parts) => {
    const spy = injectParts(parts);
    expect(businessDate(NOW)).toBe("2026-09-28");
    expect(spy).toHaveBeenCalledWith(NOW);
  });

  // ชิ้นส่วนที่หายได้ "" แทน (?? "") → สตริงผิดรูปที่ docPeriod() ปฏิเสธ — Intl ที่พังออกงวดเลขที่เอกสารผิดเงียบ ๆ ไม่ได้
  it.each<[string, string, Intl.DateTimeFormatPart[]]>([
    ["ไม่มี year", "-09-28", [MONTH, DASH, DAY]],
    ["ไม่มี month", "2026--28", [YEAR, DASH, DAY]],
    ["ไม่มี day", "2026-09-", [YEAR, DASH, MONTH]],
    ["ไม่มีสักชิ้น", "--", []],
  ])("%s → %j · ไม่มีคำว่า undefined · docPeriod() โยน RangeError", (_label, expected, parts) => {
    const spy = injectParts(parts);
    const result = businessDate(NOW);
    expect(spy).toHaveBeenCalledWith(NOW);
    expect(result).toBe(expected);
    expect(result).not.toContain("undefined");
    expect(() => docPeriod(result)).toThrow(RangeError);

    // คืน Intl ของจริงแล้วต้องได้ค่าปกติทันที — ไม่มีผลเสียค้างอยู่ใน cache
    vi.restoreAllMocks();
    expect(businessDate(NOW)).toBe("2026-09-28");
  });
});

describe("businessTime — เวลาไทย HH:MM (24 ชม.)", () => {
  it.each([
    ["2026-09-28T03:05:00Z", "10:05"],
    ["2026-09-27T16:59:59Z", "23:59"], // วินาทีตัดทิ้ง ไม่ปัดขึ้น
    ["2026-09-27T17:00:00Z", "00:00"], // เที่ยงคืนไทย = 00 ไม่ใช่ 24
    ["2026-09-27T17:30:00Z", "00:30"],
  ])("%s → %s", (iso, expected) => {
    expect(businessTime(new Date(iso))).toBe(expected);
  });

  it("เปลี่ยนเขตเวลาได้", () => {
    expect(businessTime(new Date("2026-09-27T18:30:00Z"), "UTC")).toBe("18:30");
  });
});

// ---------- businessTime — ต่อจากบล็อกของ dev ด้านบน (บล็อกนั้นคงไว้ตามเดิม) ----------

describe("businessTime — ค่า default: ตารางตัดสินใจ now × timeZone (fake timers)", () => {
  // นาฬิกาปลอมอยู่ในอดีต (เหตุผลเดียวกับ businessDate) · วินาทีและ ms ไม่เป็นศูนย์ เพื่อให้เห็นว่าตัดทิ้ง
  // นาฬิกา 2025-06-30T18:47:12.345Z = ไทย 01:47:12.345 วันที่ 1 ก.ค. → "01:47" · UTC → "18:47"
  // now ที่ส่งมา 2027-03-15T20:05:59.999Z = ไทย 03:05:59.999 วันที่ 16 มี.ค. → "03:05" · UTC → "20:05" — ผล 4 แบบต่างกันหมด
  const CLOCK = "2025-06-30T18:47:12.345Z";
  const NOW = new Date("2027-03-15T20:05:59.999Z");
  it.each<[string, string, () => string]>([
    ["ไม่ส่งทั้งคู่ → นาฬิกา · เวลาไทย", "01:47", () => businessTime()],
    ["undefined ทั้งคู่ → เหมือนไม่ส่ง", "01:47", () => businessTime(undefined, undefined)],
    ["now undefined · UTC → นาฬิกา · UTC", "18:47", () => businessTime(undefined, "UTC")],
    ["ส่ง now · ไม่ส่ง timeZone → now · เวลาไทย (api ส่ง c.var.now())", "03:05", () => businessTime(NOW)],
    ["ส่ง now · timeZone undefined → now · เวลาไทย", "03:05", () => businessTime(NOW, undefined)],
    ["ส่ง now · UTC → now · UTC", "20:05", () => businessTime(NOW, "UTC")],
  ])("%s → %s", (_label, expected, call) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(CLOCK));
    expect(call()).toBe(expected);
  });

  it("อ่านนาฬิกาใหม่ทุกครั้งที่เรียก — เดินนาฬิกา 1 ms ข้ามเที่ยงคืนไทยได้ 00:00 ไม่ใช่ 24:00", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-30T16:59:59.999Z")); // 23:59:59.999 ไทย 30 มิ.ย. 2025
    expect(businessTime()).toBe("23:59");
    vi.advanceTimersByTime(1); // 17:00:00.000Z = 00:00:00.000 ไทย 1 ก.ค. 2025
    expect(businessTime()).toBe("00:00");
  });
});

describe("businessTime — รอยต่อนาทีและชั่วโมงถึงระดับมิลลิวินาที (BVA)", () => {
  // วันไทย 28 ก.ย. 2026 · เวลาไทย = UTC + 7 ชม. — ถ้าปัดวินาทีแทนการตัดทิ้ง แถว :30.000 และ :59.999 จะขึ้นนาทีถัดไป
  it.each([
    ["2026-09-28T03:05:00.000Z", "10:05"], // ms แรกของนาที 10:05
    ["2026-09-28T03:05:29.999Z", "10:05"], // ต่ำกว่าครึ่งนาที 1 ms
    ["2026-09-28T03:05:30.000Z", "10:05"], // ครึ่งนาทีพอดี — ปัดครึ่งขึ้นจะได้ 10:06
    ["2026-09-28T03:05:59.999Z", "10:05"], // ms สุดท้ายของนาที — ปัดจะได้ 10:06
    ["2026-09-28T03:06:00.000Z", "10:06"], // ms แรกของนาทีถัดไป
  ])("นาที · วินาทีตัดทิ้ง ไม่ปัด: %s → %s", (iso, expected) => {
    expect(businessTime(new Date(iso))).toBe(expected);
  });

  it.each([
    ["2026-09-28T03:59:59.999Z", "10:59"], // ms สุดท้ายของชั่วโมง 10
    ["2026-09-28T04:00:00.000Z", "11:00"], // ms แรกของชั่วโมง 11
    ["2026-09-27T16:59:59.999Z", "23:59"], // ms สุดท้ายของวันไทย 27 ก.ย.
    ["2026-09-27T17:00:00.000Z", "00:00"], // เที่ยงคืนไทยพอดี — h23 ได้ 00:00 ไม่ใช่ 24:00 (h24) หรือ 12:00 (h12)
    ["2026-09-27T17:00:00.001Z", "00:00"], // เกินเที่ยงคืน 1 ms
    ["2026-09-27T17:00:59.999Z", "00:00"], // ms สุดท้ายของนาที 00:00
    ["2026-09-27T17:01:00.000Z", "00:01"],
    ["2026-09-27T23:59:59.999Z", "06:59"], // ก่อนเที่ยงคืน UTC 1 ms — ถ้าใช้เวลา UTC จะได้ 23:59
    ["2026-09-28T00:00:00.000Z", "07:00"], // เที่ยงคืน UTC — ถ้าใช้เวลา UTC จะได้ 00:00
  ])("ชั่วโมง · เที่ยงคืนไทย · เที่ยงคืน UTC: %s → %s", (iso, expected) => {
    expect(businessTime(new Date(iso))).toBe(expected);
  });

  it.each([
    ["2026-09-28T02:59:59.999Z", "09:59"], // ชั่วโมงหลักเดียวตัวสุดท้าย — เติม 0
    ["2026-09-28T03:00:00.000Z", "10:00"], // ชั่วโมงสองหลักตัวแรก
    ["2026-09-28T03:09:59.999Z", "10:09"], // นาทีหลักเดียวตัวสุดท้าย — เติม 0
    ["2026-09-28T03:10:00.000Z", "10:10"], // นาทีสองหลักตัวแรก
  ])("เติม 0 สองหลัก รอยต่อ 09 | 10: %s → %s", (iso, expected) => {
    expect(businessTime(new Date(iso))).toBe(expected);
  });
});

describe("businessTime — ครบ 24 ชั่วโมงของวันไทยแบบ h23: 00–23 (EP ครบโดเมนชั่วโมง)", () => {
  // ชั่วโมงไทย h ของวันที่ 28 ก.ย. 2026 = 2026-09-27T17:00Z + h ชม. · ms แรก → "hh:00" · ms สุดท้าย (+ 1 ชม. − 1 ms) → "hh:59"
  // จับรอบชั่วโมงแบบอื่น: h24 (เที่ยงคืนเป็น 24) · h12 (เที่ยงคืนเป็น 12 · บ่ายโมงเป็น 01) · h11 (เที่ยงวันเป็น 00)
  it.each<[number, string, string]>([
    [0, "00:00", "00:59"], // เที่ยงคืน — h24 ได้ 24 · h12 ได้ 12
    [1, "01:00", "01:59"],
    [2, "02:00", "02:59"],
    [3, "03:00", "03:59"],
    [4, "04:00", "04:59"],
    [5, "05:00", "05:59"],
    [6, "06:00", "06:59"],
    [7, "07:00", "07:59"], // UTC ข้ามเที่ยงคืนในชั่วโมงนี้ — เวลาไทยไม่สะดุด
    [8, "08:00", "08:59"],
    [9, "09:00", "09:59"],
    [10, "10:00", "10:59"],
    [11, "11:00", "11:59"],
    [12, "12:00", "12:59"], // เที่ยงวัน — h11 ได้ 00
    [13, "13:00", "13:59"], // บ่ายโมง — h11 และ h12 ได้ 01
    [14, "14:00", "14:59"],
    [15, "15:00", "15:59"],
    [16, "16:00", "16:59"],
    [17, "17:00", "17:59"],
    [18, "18:00", "18:59"],
    [19, "19:00", "19:59"],
    [20, "20:00", "20:59"],
    [21, "21:00", "21:59"],
    [22, "22:00", "22:59"],
    [23, "23:00", "23:59"], // ชั่วโมงสุดท้ายของวัน
  ])("ชั่วโมงไทย %i: ms แรก → %s · ms สุดท้าย → %s", (hour, first, last) => {
    const start = Date.UTC(2026, 8, 27, 17 + hour); // เดือน 8 = ก.ย. · Date.UTC ทบชั่วโมงที่เกิน 23 ไปวันถัดไปเอง
    expect(businessTime(new Date(start))).toBe(first);
    expect(businessTime(new Date(start + 3_599_999))).toBe(last);
  });
});

describe("businessTime — เขตเวลาอื่น instant เดียวกัน (EP: offset เต็มชั่วโมง · ครึ่งชั่วโมง · 45 นาที · หลัง/หน้า UTC)", () => {
  // 2026-09-28T03:05:30.000Z · ทุกเขตไม่มี DST — ชั่วโมงมาจาก offset ของเขตอย่างเดียว ไม่ผูกกับกฎ DST ใน tzdata
  // เขตที่ offset ไม่เต็มชั่วโมงจับโค้ดที่เอานาทีของ UTC มาใช้ตรง ๆ (ซึ่งถูกเฉพาะเขตที่ offset เต็มชั่วโมงอย่างไทย)
  it.each([
    ["Pacific/Honolulu", "17:05"], // −10 → 17:05:30 ของวันที่ 27
    ["UTC", "03:05"], // 03:05:30
    ["Asia/Kolkata", "08:35"], // +5:30 → 08:35:30
    ["Asia/Kathmandu", "08:50"], // +5:45 → 08:50:30
    ["Asia/Bangkok", "10:05"], // +7 → 10:05:30
    ["Asia/Tokyo", "12:05"], // +9 → 12:05:30
    ["Pacific/Kiritimati", "17:05"], // +14 → 17:05:30 ของวันที่ 28 — นาฬิกาเท่า Honolulu แต่คนละวัน
  ])("%s → %s", (timeZone, expected) => {
    expect(businessTime(new Date("2026-09-28T03:05:30.000Z"), timeZone)).toBe(expected);
  });
});

describe("businessTime — ไม่ขึ้นกับ TZ ของเครื่องที่รัน (เหตุผลและ control เดียวกับของ businessDate)", () => {
  it.each<[string, number]>([
    ["UTC", 0], // เซิร์ฟเวอร์และ CI
    ["Asia/Bangkok", -420], // +7 — เครื่อง dev ในไทย
    ["Pacific/Honolulu", 600], // −10
    ["Pacific/Kiritimati", -840], // +14
  ])("TZ=%s → เวลาไทยเท่าเดิม", (tz, offsetMinutes) => {
    vi.stubEnv("TZ", tz);
    expect(new Date("2026-09-27T17:00:00.000Z").getTimezoneOffset()).toBe(offsetMinutes);
    expect(businessTime(new Date("2026-09-27T16:59:59.999Z"))).toBe("23:59"); // ก่อนเที่ยงคืนไทย 1 ms
    expect(businessTime(new Date("2026-09-27T17:00:00.000Z"))).toBe("00:00"); // เที่ยงคืนไทย
    expect(businessTime(new Date("2026-09-28T03:05:30.000Z"))).toBe("10:05");
  });
});

describe("businessDate + businessTime — instant เดียวกันเป็นเวลาไทยขณะเดียวกัน ไม่เหลื่อมวันรอบเที่ยงคืน", () => {
  // บิลเก็บวันกับเวลาแยกช่อง (buy_receipt.date · buy_receipt.time) — คู่ที่เหลื่อมกัน เช่น วันใหม่ + 23:59
  // หรือวันเก่า + 00:00 คือเวลาที่ไม่เคยเกิดขึ้นจริงบนบิล
  it.each<[string, string, string, string]>([
    ["2026-09-27T16:59:59.999Z", SHOP_TIME_ZONE, "2026-09-27", "23:59"], // ms สุดท้ายของวันไทย
    ["2026-09-27T17:00:00.000Z", SHOP_TIME_ZONE, "2026-09-28", "00:00"], // เที่ยงคืนไทย
    ["2026-09-27T17:00:59.999Z", SHOP_TIME_ZONE, "2026-09-28", "00:00"],
    ["2026-09-27T23:59:59.999Z", SHOP_TIME_ZONE, "2026-09-28", "06:59"], // ก่อนเที่ยงคืน UTC — UTC ยังวันที่ 27
    ["2026-09-28T00:00:00.000Z", SHOP_TIME_ZONE, "2026-09-28", "07:00"], // เที่ยงคืน UTC
    ["2026-12-31T16:59:59.999Z", SHOP_TIME_ZONE, "2026-12-31", "23:59"], // ก่อนปีใหม่ไทย 1 ms
    ["2026-12-31T17:00:00.000Z", SHOP_TIME_ZONE, "2027-01-01", "00:00"], // ปีใหม่ไทย — UTC ยัง 31 ธ.ค.
    ["2026-09-27T17:00:00.000Z", "UTC", "2026-09-27", "17:00"], // ส่ง timeZone เดียวกันให้ทั้งคู่
    ["2026-09-28T03:05:30.000Z", "Pacific/Honolulu", "2026-09-27", "17:05"], // −10
    ["2026-09-28T03:05:30.000Z", "Pacific/Kiritimati", "2026-09-28", "17:05"], // +14 — นาฬิกาเท่ากัน แต่คนละวัน
  ])("%s ที่ %s → %s %s", (iso, timeZone, date, time) => {
    const now = new Date(iso);
    expect([businessDate(now, timeZone), businessTime(now, timeZone)]).toEqual([date, time]);
  });

  it("ทุกจังหวะรอบเที่ยงคืนปีใหม่ไทย: วัน + เวลา ตีความเป็น +07:00 ได้ instant เดิมตัดเหลือนาทีเต็ม (metamorphic)", () => {
    // ไล่ 23:55–00:05 ไทย (31 ธ.ค. 2026 → 1 ม.ค. 2027) ทีละ 7,001 ms ให้วินาทีและ ms เปลี่ยนทุกจังหวะ
    // ความสัมพันธ์มาจากนิยาม "เวลาไทย = UTC + 7" ไม่ได้มาจากโค้ด: วันกับเวลาคู่เดียวกันต้องชี้ instant เดียวกัน ตัดวินาทีทิ้ง
    // 600,000 ms ÷ 7,001 = 85 ก้าวเต็ม → ตรวจ 86 จังหวะ (นับไว้ กันลูปที่ไม่ได้วนเลยแล้วผ่านเฉย ๆ)
    const mismatches: string[] = [];
    let checked = 0;
    for (let t = Date.UTC(2026, 11, 31, 16, 55); t <= Date.UTC(2026, 11, 31, 17, 5); t += 7_001) {
      const now = new Date(t);
      const wallClock = `${businessDate(now)}T${businessTime(now)}:00.000+07:00`;
      if (Date.parse(wallClock) !== t - (t % 60_000)) mismatches.push(`${now.toISOString()} → ${wallClock}`);
      checked += 1;
    }
    expect(checked).toBe(86);
    expect(mismatches).toEqual([]);
  });
});

describe("businessTime — ไม่มี state ข้ามการเรียก (error guessing)", () => {
  it("เรียกซ้ำ สลับเขตเวลา หลังเจอ error ก็ได้ผลเดิม และไม่แก้ Date ที่ส่งมา", () => {
    const now = new Date("2026-09-28T03:05:30.000Z"); // ไทย 10:05:30 · UTC 03:05:30
    expect(businessTime(now)).toBe("10:05");
    expect(businessTime(now, "UTC")).toBe("03:05");
    expect(businessTime(now)).toBe("10:05");
    expect(() => businessTime(now, "Mars/Olympus")).toThrow(RangeError);
    expect(businessTime(now, "UTC")).toBe("03:05");
    expect(businessTime(now)).toBe("10:05");
    expect(now.toISOString()).toBe("2026-09-28T03:05:30.000Z");
  });
});

describe("businessTime — input ผิด → RangeError ไม่คืนเวลามั่ว (fail-closed · EP + BVA ขอบของ Date)", () => {
  it.each<[string, Date]>([
    ['new Date("x") — ข้อความที่ parse ไม่ได้', new Date("x")],
    ["new Date(NaN)", new Date(Number.NaN)],
    ["8.64e15 + 1 ms — เกินเพดานบนของ Date 1 ms", new Date(8.64e15 + 1)],
    ["−8.64e15 − 1 ms — ต่ำกว่าพื้นของ Date 1 ms", new Date(-8.64e15 - 1)],
    ['string "10:05" จากโค้ด JS ที่ไม่มี type — แปลงเป็นตัวเลขได้ NaN', "10:05" as unknown as Date],
  ])("now = %s → RangeError", (_label, now) => {
    expect(() => businessTime(now)).toThrow(RangeError);
  });

  it.each<[string | null, string]>([
    ["Mars/Olympus", "ไม่มีในฐานข้อมูลเขตเวลา IANA"],
    ["", "สตริงว่าง เช่น env ที่มีชื่อแต่ไม่มีค่า — ต้องไม่ตกไปใช้ Asia/Bangkok หรือ UTC เงียบ ๆ"],
    ["Asia/Bangkok ", "มีเว้นวรรคท้าย — ค่า config ที่ไม่ได้ trim"],
    [null, "null จากโค้ด JS ที่ไม่มี type — default ใช้เฉพาะ undefined"],
  ])("timeZone %j (%s) → RangeError", (timeZone) => {
    expect(() => businessTime(new Date("2026-09-28T03:05:30.000Z"), timeZone as string)).toThrow(RangeError);
  });
});

describe("businessTime — fault injection: Intl.DateTimeFormat คืนชิ้นส่วนผิดรูป (ICU จริงไม่เกิด จึงจำลองด้วย spy)", () => {
  // ชิ้นส่วนที่ en-GB (h23) ควรคืนสำหรับ 10:05:30 ไทย
  const NOW = new Date("2026-09-28T03:05:30.000Z");
  const HOUR: Intl.DateTimeFormatPart = { type: "hour", value: "10" };
  const MINUTE: Intl.DateTimeFormatPart = { type: "minute", value: "05" };
  const COLON: Intl.DateTimeFormatPart = { type: "literal", value: ":" };
  const DOT: Intl.DateTimeFormatPart = { type: "literal", value: "." };

  const injectParts = (parts: Intl.DateTimeFormatPart[]) =>
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockReturnValue(parts);

  it.each<[string, Intl.DateTimeFormatPart[]]>([
    ["ครบตามลำดับ en-GB (control ว่า spy ถูกเรียกจริง)", [HOUR, COLON, MINUTE]],
    ["ลำดับ นาที.ชั่วโมง คั่นด้วยจุด (ถ้า CLDR เปลี่ยน pattern)", [MINUTE, DOT, HOUR]],
  ])("%s → ยังได้ 10:05 เพราะหยิบตามชนิดชิ้นส่วน ไม่ใช่ตามตำแหน่ง", (_label, parts) => {
    const spy = injectParts(parts);
    expect(businessTime(NOW)).toBe("10:05");
    expect(spy).toHaveBeenCalledWith(NOW);
  });

  // ชิ้นส่วนที่หายได้ "" แทน (?? "") ไม่ใช่ "undefined" · ปลายทางคือคอลัมน์ buy_receipt.time (Postgres time):
  // ":05" และ ":" Postgres ปฏิเสธ (บันทึกบิลล้มทั้งทรานแซกชัน) แต่ "10:" ถูกเก็บเป็น 10:00:00 เงียบ ๆ — fail-open
  // ที่ยังเปิดอยู่ ถ้าแก้ให้โยน RangeError แถว "ไม่มี minute" ต้องเปลี่ยนตาม
  it.each<[string, string, Intl.DateTimeFormatPart[]]>([
    ["ไม่มี hour", ":05", [COLON, MINUTE]],
    ["ไม่มี minute", "10:", [HOUR, COLON]],
    ["ไม่มีทั้งคู่", ":", []],
  ])("%s → %j · ไม่มีคำว่า undefined", (_label, expected, parts) => {
    const spy = injectParts(parts);
    const result = businessTime(NOW);
    expect(spy).toHaveBeenCalledWith(NOW);
    expect(result).toBe(expected);
    expect(result).not.toContain("undefined");

    // คืน Intl ของจริงแล้วต้องได้ค่าปกติทันที — ไม่มีผลเสียค้างอยู่ใน cache
    vi.restoreAllMocks();
    expect(businessTime(NOW)).toBe("10:05");
  });
});

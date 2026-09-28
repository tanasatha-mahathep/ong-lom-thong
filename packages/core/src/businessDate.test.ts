import { afterEach, describe, expect, it, vi } from "vitest";
import { businessDate, SHOP_TIME_ZONE } from "./businessDate";
import { docPeriod } from "./docNo";

// ค่าที่คาดทุกตัวคิดมือ ไม่ได้รันโค้ดแล้วลอกผล:
// - Asia/Bangkok = UTC+7 ตลอดปี ไม่มี DST → เวลาไทย = UTC + 7 ชม.
// - วันไทย D เริ่ม 17:00:00.000Z ของวันก่อนหน้า และจบ 16:59:59.999Z ของวัน D → รอยต่อวันอยู่ที่ 17:00Z ไม่ใช่ 00:00Z
// - ปีอธิกสุรทิน (เกรกอเรียน): หาร 4 ลงตัว ยกเว้นหาร 100 ลงตัวแต่หาร 400 ไม่ลงตัว → 2028 อธิก · 2027 ปกติ
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

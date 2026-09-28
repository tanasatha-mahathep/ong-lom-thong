import { describe, expect, it } from "vitest";
import { cardStatus, parseThaiDate } from "./card";

const TODAY = "2026-09-28";

describe("parseThaiDate — รูปแบบที่ Siam ID พิมพ์", () => {
  it.each([
    ["31/12/2570", "2027-12-31"],
    ["1/1/2570", "2027-01-01"],
    ["31-12-2027", "2027-12-31"],
    ["31.12.2027", "2027-12-31"],
    ["2027-12-31", "2027-12-31"],
    ["2570-12-31", "2027-12-31"],
    [" 05/06/2569 ", "2026-06-05"],
  ])("%j → %s", (input, iso) => {
    expect(parseThaiDate(input)).toBe(iso);
  });

  it.each(["", "abc", "30/02/2570", "31/04/2570", "13/13/2570", "1/1/70", "2027/12/31", null, undefined])(
    "ใช้ไม่ได้: %j → null",
    (input) => {
      expect(parseThaiDate(input)).toBeNull();
    },
  );
});

// [ไทยเต็ม, ไทยย่อ, อังกฤษ] — ตัวสะกดไทยคัดจาก Django core/templatetags/thai.py (TH_MONTHS · TH_MONTHS_ABBR)
// ชุดเดียวกับที่ bridge/card_reader.py ใช้แปลงวันที่จากชิป (THAI_MONTHS)
const MONTHS = [
  ["มกราคม", "ม.ค.", "January"],
  ["กุมภาพันธ์", "ก.พ.", "February"],
  ["มีนาคม", "มี.ค.", "March"],
  ["เมษายน", "เม.ย.", "April"],
  ["พฤษภาคม", "พ.ค.", "May"],
  ["มิถุนายน", "มิ.ย.", "June"],
  ["กรกฎาคม", "ก.ค.", "July"],
  ["สิงหาคม", "ส.ค.", "August"],
  ["กันยายน", "ก.ย.", "September"],
  ["ตุลาคม", "ต.ค.", "October"],
  ["พฤศจิกายน", "พ.ย.", "November"],
  ["ธันวาคม", "ธ.ค.", "December"],
] as const;

describe("parseThaiDate — ชื่อเดือน (Siam ID · ระบบเดิม · หน้าบัตร) และค่าดิบจากชิป", () => {
  it.each([
    ["1 มกราคม 2570", "2027-01-01"], // Siam ID / ระบบเดิม (placeholder "ตัวอย่าง 1 มกราคม 2540")
    ["31 ธันวาคม 2574", "2031-12-31"],
    ["31 ธ.ค. 2574", "2031-12-31"], // หน้าบัตร
    ["31 ธค 2574", "2031-12-31"],
    ["31 ธ.ค 2574", "2031-12-31"],
    ["31 ธค. 2574", "2031-12-31"],
    ["  1   มีนาคม   พ.ศ. 2570 ", "2027-03-01"],
    ["1 มีนาคม พ.ศ.2570", "2027-03-01"],
    ["1 มีนาคม พศ 2570", "2027-03-01"],
    ["1มีนาคม2570", "2027-03-01"],
    ["31ธ.ค.2574", "2031-12-31"],
    ["01 มกราคม 2570", "2027-01-01"],
    ["1\tมกราคม\u00A02570", "2027-01-01"], // tab · non-breaking space
    ["1 มกรา\u200Bคม 2570", "2027-01-01"], // zero-width space ที่ติดมากับการ copy
    ["29 กุมภาพันธ์ 2571", "2028-02-29"], // ปีอธิกสุรทิน
    ["1 มกราคม 2027", "2027-01-01"], // ปี ค.ศ. กับชื่อเดือนไทย — กฎปี ≥ 2400 เดิม
    ["1 มกราคม ค.ศ. 2027", "2027-01-01"],
    ["1 ม.ค.ค.ศ.2027", "2027-01-01"],
    ["1 พ.ค.พ.ศ.2570", "2027-05-01"],
    ["1 Jan. 2027", "2027-01-01"], // หน้าบัตรภาษาอังกฤษ
    ["1 Jan 2027", "2027-01-01"],
    ["1 January 2027", "2027-01-01"],
    ["1 JANUARY 2027", "2027-01-01"],
    ["1 jan. 2027", "2027-01-01"],
    ["15 Sept. 2027", "2027-09-15"],
    ["1 Jan 2570", "2027-01-01"],
    ["25700101", "2027-01-01"], // ค่าดิบจากชิป YYYYMMDD พ.ศ.
    ["25741231", "2031-12-31"],
    ["20270101", "2027-01-01"],
  ])("%j → %s", (input, iso) => {
    expect(parseThaiDate(input)).toBe(iso);
  });

  it.each(MONTHS.map(([thai, abbr, english], i) => [thai, abbr, english, `2027-${String(i + 1).padStart(2, "0")}-15`]))(
    "เดือน %s · %s · %s → %s ทุกตัวสะกดที่รับ",
    (thai, abbr, english, iso) => {
      const [first = "", second = ""] = abbr.split(".");
      const spellings = [
        thai,
        abbr, // ม.ค.
        `${first}.${second}`, // ม.ค
        `${first}${second}.`, // มค.
        `${first}${second}`, // มค
        english,
        english.toUpperCase(),
        english.toLowerCase(),
        `${english.slice(0, 3)}.`,
        english.slice(0, 3),
      ];
      for (const s of spellings) expect(parseThaiDate(`15 ${s} 2570`), s).toBe(iso);
    },
  );

  it("ทุกวันของปี 2567–2576: รูปแบบของ bridge (_thdate) · แบบย่อหน้าบัตร · ค่าดิบจากชิป อ่านกลับได้วันเดิม", () => {
    for (let t = Date.UTC(2024, 0, 1); t <= Date.UTC(2033, 11, 31); t += 86_400_000) {
      const dt = new Date(t);
      const iso = dt.toISOString().slice(0, 10);
      const [thai = "", abbr = ""] = MONTHS[dt.getUTCMonth()] ?? [];
      const d = dt.getUTCDate();
      const be = dt.getUTCFullYear() + 543;
      expect(parseThaiDate(`${d} ${thai} ${be}`)).toBe(iso);
      expect(parseThaiDate(`${d} ${abbr} ${be}`)).toBe(iso);
      expect(parseThaiDate(`${be}${iso.slice(5, 7)}${iso.slice(8, 10)}`)).toBe(iso);
    }
  });

  it.each([
    "31 กุมภาพันธ์ 2570", // ไม่มีวันจริงในปฏิทิน
    "29 ก.พ. 2570", // 2027 ไม่ใช่ปีอธิกสุรทิน
    "31 เม.ย. 2570",
    "32 มกราคม 2570",
    "0 มกราคม 2570",
    "123 มกราคม 2570",
    "1 xyz 2570",
    "1 มกรา 2570", // ชื่อเดือนแบบพูด — ตั้งใจไม่รับ ชื่อเดือนต้องสะกดตรงตัว
    "1 ธันวา 2570",
    "1 Janu 2027",
    "1 ม ค 2570", // ช่องว่างกลางชื่อย่อ
    "1 ม..ค. 2570",
    "1 .ม.ค. 2570",
    "1 มกราคม ค.ศ. 2570", // ศักราชที่เขียนไว้ขัดกับตัวปี
    "1 มกราคม พ.ศ. 2027",
    "1 มกราคม 70", // ปี 2 หลัก
    "1 มกราคม 25700",
    "1 มกราคม",
    "มกราคม 2570",
    "January 1, 2027", // เดือนขึ้นก่อนแบบอเมริกัน
    "1 มกราคม 2570 10:00",
    "วันที่ 1 มกราคม 2570",
    "99999999", // บัตรตลอดชีพจากชิป — ไม่ใช่วันที่ (cardStatus ถือเป็น ok เอง)
    "25701301", // เดือน 13
    "25700230",
    "2570011", // 7 หลัก
    "257001011", // 9 หลัก
    "\u200B",
  ])("ใช้ไม่ได้: %j → null", (input) => {
    expect(parseThaiDate(input)).toBeNull();
  });
});

describe("cardStatus — ระบบเดิม status 0/1/2/3 บล็อกทั้ง 3 กรณีที่ไม่ ok", () => {
  it("ยังไม่หมดอายุ → ok", () => expect(cardStatus("31/12/2570", TODAY)).toBe("ok"));
  it("หมดอายุวันนี้พอดี → ยัง ok", () => expect(cardStatus("28/09/2569", TODAY)).toBe("ok"));
  it("หมดอายุแล้ว → expired", () => expect(cardStatus("27/09/2569", TODAY)).toBe("expired"));
  it("ว่าง → missing", () => {
    expect(cardStatus("", TODAY)).toBe("missing");
    expect(cardStatus("   ", TODAY)).toBe("missing");
    expect(cardStatus(null, TODAY)).toBe("missing");
  });
  it("รูปแบบผิด → invalid", () => expect(cardStatus("31/02/2570", TODAY)).toBe("invalid"));
  it("บัตรผู้สูงอายุ 'ตลอดชีพ' → ok", () => {
    expect(cardStatus("ตลอดชีพ", TODAY)).toBe("ok");
    expect(cardStatus("Lifetime", TODAY)).toBe("ok");
  });

  it.each([
    ["28 กันยายน 2569", "ok"], // หมดอายุวันนี้พอดี
    ["27 กันยายน 2569", "expired"],
    ["28 ก.ย. 2569", "ok"],
    ["27 ก.ย. 2569", "expired"],
    ["27 กย 2569", "expired"],
    ["28 Sep. 2026", "ok"],
    ["27 Sep. 2026", "expired"],
    ["25690928", "ok"],
    ["25690927", "expired"],
    ["1 มกราคม 2570", "ok"],
    ["31 ธันวาคม 2574", "ok"],
    ["1 มกรา 2570", "invalid"],
    ["31 กุมภาพันธ์ 2570", "invalid"],
    ["1 มกราคม ค.ศ. 2570", "invalid"],
    ["\u200B ", "missing"],
  ])("ชื่อเดือน / ค่าดิบจากชิป: %j → %s", (text, status) => {
    expect(cardStatus(text, TODAY)).toBe(status);
  });

  it.each(["99999999", " 99999999 ", "LIFELONG", "lifelong", "Life Long", "life-long", "ตลอดชีพ / LIFELONG"])(
    "บัตรตลอดชีพ (หน้าบัตร / ชิป) %j → ok",
    (text) => {
      expect(cardStatus(text, TODAY)).toBe("ok");
    },
  );

  it.each(["9999999", "999999999", "99999998"])("เลข 9 ที่ไม่ใช่ค่าตลอดชีพของชิป %j → invalid", (text) => {
    expect(cardStatus(text, TODAY)).toBe("invalid");
  });
});

describe("บัตรตลอดชีพ — ทั้งช่องต้องเป็นคำนั้นเท่านั้น", () => {
  it.each(["ตลอดชีพ", " LIFELONG ", "life long", "Lifetime"])("%j = ok", (text) => {
    expect(cardStatus(text, "2026-09-29")).toBe("ok");
  });

  it.each(["บัตรตลอดชีพ", "ตลอดชีพ?", "not lifelong", "lifelong 2570"])("%j = invalid", (text) => {
    expect(cardStatus(text, "2026-09-29")).toBe("invalid");
  });
});

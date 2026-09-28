export type CardStatus = "ok" | "expired" | "missing" | "invalid";

export const CARD_STATUS_MESSAGE: Record<Exclude<CardStatus, "ok">, string> = {
  expired: "บัตรประชาชนหมดอายุแล้ว",
  missing: "ยังไม่ได้กรอกวันที่บัตรหมดอายุ",
  invalid: "รูปแบบวันที่บัตรหมดอายุไม่ถูกต้อง",
};

/** บัตรไม่มีวันหมดอายุ (ผู้สูงอายุ) — หน้าบัตรพิมพ์ "ตลอดชีพ" / "LIFELONG" */
const LIFETIME = /ตลอดชีพ|life[\s-]*(?:time|long)/i;
/** วันหมดอายุของบัตรตลอดชีพที่อ่านจากชิป (ชิปเก็บ YYYYMMDD) */
const LIFETIME_CHIP = "99999999";
/** อักขระล่องหนที่ติดมากับการ copy/paste ข้อความไทย (zero-width space ฯลฯ) */
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;

const DMY = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
/** วันที่ดิบจากชิปบัตร: YYYYMMDD ปี พ.ศ. เช่น 25700101 */
const YMD_COMPACT = /^(\d{4})(\d{2})(\d{2})$/;
/**
 * วัน ชื่อเดือน ปี — ช่องว่างระหว่างส่วนกี่ตัวก็ได้ (ไม่มีก็ได้) · "พ.ศ." / "ค.ศ." หน้าปีมีหรือไม่มีก็ได้ (จุดไม่บังคับ)
 * ชื่อเดือนจับเป็นข้อความที่ไม่มีช่องว่าง/ตัวเลข แล้วตรวจกับ MONTHS อีกชั้น
 */
const DAY_MONTH_YEAR = /^(\d{1,2})\s*([^\s\d]+?)\s*(?:([พค])\.?\s*ศ\.?\s*)?(\d{4})$/;

/**
 * ชื่อเดือนที่รับ เรียงตามเดือน: ไทยเต็ม · ไทยย่อ · อังกฤษเต็ม · อังกฤษย่อ
 * ตัวสะกดไทยตรงกับ Django core/templatetags/thai.py (TH_MONTHS · TH_MONTHS_ABBR) และ bridge/card_reader.py
 * ชื่อย่อจุดแต่ละตัวมีหรือไม่มีก็ได้ (ม.ค. · ม.ค · มค. · มค) แต่ตัวอักษรต้องตรงตัว — ชื่อแบบพูด ("มกรา") ไม่รับ
 */
const MONTH_NAMES: readonly (readonly string[])[] = [
  ["มกราคม", "ม.ค.", "january", "jan."],
  ["กุมภาพันธ์", "ก.พ.", "february", "feb."],
  ["มีนาคม", "มี.ค.", "march", "mar."],
  ["เมษายน", "เม.ย.", "april", "apr."],
  ["พฤษภาคม", "พ.ค.", "may", "may."],
  ["มิถุนายน", "มิ.ย.", "june", "jun."],
  ["กรกฎาคม", "ก.ค.", "july", "jul."],
  ["สิงหาคม", "ส.ค.", "august", "aug."],
  ["กันยายน", "ก.ย.", "september", "sep.", "sept."],
  ["ตุลาคม", "ต.ค.", "october", "oct."],
  ["พฤศจิกายน", "พ.ย.", "november", "nov."],
  ["ธันวาคม", "ธ.ค.", "december", "dec."],
];

/** "ม.ค." → ม.ค. · ม.ค · มค. · มค — จุดแต่ละตัวมีหรือไม่มีก็ได้ */
const dotVariants = (name: string): string[] => {
  const [head = "", ...rest] = name.split(".");
  return rest.reduce((out, piece) => out.flatMap((s) => [`${s}.${piece}`, s + piece]), [head]);
};

/** ชื่อเดือน (ตัวพิมพ์เล็ก) → เลขเดือน 1–12 */
const MONTHS = new Map<string, number>(
  MONTH_NAMES.flatMap((names, i) => names.flatMap(dotVariants).map((name) => [name, i + 1] as const)),
);

const clean = (text: string | null | undefined) => (text ?? "").replace(INVISIBLE, "").trim();

interface DateParts {
  y: number;
  m: number;
  d: number;
  /** ศักราชที่เขียนกำกับปีไว้ (ถ้ามี) */
  era?: "BE" | "CE";
}

function splitDate(t: string): DateParts | null {
  const dmy = DMY.exec(t);
  if (dmy) return { d: Number(dmy[1]), m: Number(dmy[2]), y: Number(dmy[3]) };
  const ymd = YMD.exec(t) ?? YMD_COMPACT.exec(t);
  if (ymd) return { y: Number(ymd[1]), m: Number(ymd[2]), d: Number(ymd[3]) };
  const named = DAY_MONTH_YEAR.exec(t);
  const m = named ? MONTHS.get((named[2] ?? "").toLowerCase()) : undefined;
  if (!named || m === undefined) return null;
  const era = named[3] === "พ" ? "BE" : named[3] === "ค" ? "CE" : undefined;
  return { d: Number(named[1]), m, y: Number(named[4]), era };
}

/**
 * แปลงข้อความวันที่ที่ Siam ID พิมพ์มา (เก็บ raw ไว้ด้วยเสมอ) → ISO ค.ศ. "YYYY-MM-DD"
 * รองรับ:
 * - dd/mm/yyyy · dd-mm-yyyy · dd.mm.yyyy · yyyy-mm-dd
 * - วัน ชื่อเดือน ปี: "1 มกราคม 2570" (Siam ID / ระบบเดิม) · "31 ธ.ค. 2574" · "1 Jan. 2027" (หน้าบัตร)
 *   · "1 มีนาคม พ.ศ. 2570" — ชื่อเดือนดู MONTH_NAMES · ตัวพิมพ์เล็ก/ใหญ่ไม่มีผล
 * - YYYYMMDD 8 หลัก (ค่าดิบจากชิป เช่น 25700101)
 * ปี ≥ 2400 = พ.ศ. แปลงเป็น ค.ศ. · ถ้าเขียน พ.ศ./ค.ศ. ไว้แต่ขัดกับตัวปี ("ค.ศ. 2570") = อ่านไม่ได้
 * คืน null เมื่อ parse ไม่ได้หรือไม่ใช่วันจริงในปฏิทิน
 */
export function parseThaiDate(text: string | null | undefined): string | null {
  const parts = splitDate(clean(text));
  if (!parts) return null;
  const { m, d, era } = parts;
  let { y } = parts;
  const buddhist = y >= 2400;
  if (era && (era === "BE") !== buddhist) return null;
  if (buddhist) y -= 543;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * สถานะบัตรตามระบบเดิม (get_purchase.php action=get2): 0 ok · 1 expired · 2 missing · 3 invalid
 * ทั้ง 3 กรณีที่ไม่ ok ต้อง "บล็อก" การเปิดบิล · บัตรผู้สูงอายุ "ตลอดชีพ" / "LIFELONG" / 99999999 (ชิป) = ok
 * @param today ISO ค.ศ. ของวันที่ทำรายการ — บัตรที่หมดอายุวันนี้ยังใช้ได้
 */
export function cardStatus(expireText: string | null | undefined, today: string): CardStatus {
  const t = clean(expireText);
  if (t === "") return "missing";
  if (LIFETIME.test(t) || t === LIFETIME_CHIP) return "ok";
  const iso = parseThaiDate(t);
  if (!iso) return "invalid";
  return iso >= today ? "ok" : "expired";
}

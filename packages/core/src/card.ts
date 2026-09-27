export type CardStatus = "ok" | "expired" | "missing" | "invalid";

export const CARD_STATUS_MESSAGE: Record<Exclude<CardStatus, "ok">, string> = {
  expired: "บัตรประชาชนหมดอายุแล้ว",
  missing: "ยังไม่ได้กรอกวันที่บัตรหมดอายุ",
  invalid: "รูปแบบวันที่บัตรหมดอายุไม่ถูกต้อง",
};

const LIFETIME = /ตลอดชีพ|lifetime/i;
const DMY = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * แปลงข้อความวันที่ที่ Siam ID พิมพ์มา (เก็บ raw ไว้ด้วยเสมอ) → ISO ค.ศ. "YYYY-MM-DD"
 * รองรับ dd/mm/yyyy · dd-mm-yyyy · dd.mm.yyyy · yyyy-mm-dd · ปี พ.ศ. (≥ 2400) แปลงเป็น ค.ศ.
 * คืน null เมื่อ parse ไม่ได้หรือไม่ใช่วันจริงในปฏิทิน
 */
export function parseThaiDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.trim();
  let y: number;
  let m: number;
  let d: number;
  const dmy = DMY.exec(t);
  if (dmy) {
    d = Number(dmy[1]);
    m = Number(dmy[2]);
    y = Number(dmy[3]);
  } else {
    const ymd = YMD.exec(t);
    if (!ymd) return null;
    y = Number(ymd[1]);
    m = Number(ymd[2]);
    d = Number(ymd[3]);
  }
  if (y >= 2400) y -= 543;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * สถานะบัตรตามระบบเดิม (get_purchase.php action=get2): 0 ok · 1 expired · 2 missing · 3 invalid
 * ทั้ง 3 กรณีที่ไม่ ok ต้อง "บล็อก" การเปิดบิล · บัตรผู้สูงอายุ "ตลอดชีพ" = ok
 * @param today ISO ค.ศ. ของวันที่ทำรายการ — บัตรที่หมดอายุวันนี้ยังใช้ได้
 */
export function cardStatus(expireText: string | null | undefined, today: string): CardStatus {
  if (!expireText || expireText.trim() === "") return "missing";
  if (LIFETIME.test(expireText)) return "ok";
  const iso = parseThaiDate(expireText);
  if (!iso) return "invalid";
  return iso >= today ? "ok" : "expired";
}

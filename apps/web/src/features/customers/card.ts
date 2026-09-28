import { type CardStatus, cardStatus, parseThaiDate } from "@ong/core";
import { formatThaiDate } from "@/lib/format";
import type { Message } from "./i18n";

/**
 * วันหมดอายุของบัตรที่ใช้ได้: "ใช้ได้ถึง 31 ธันวาคม 2574" · ไม่มีวันที่ = บัตรตลอดชีพ
 * @param iso วันที่ ค.ศ. ที่ parse แล้ว (ISO) — null = บัตรตลอดชีพ
 */
export function validUntil(iso: string | null): Message {
  return iso ? { key: "card.validUntil", vars: { date: formatThaiDate(iso, "long") } } : { key: "card.lifetime" };
}

/**
 * สถานะบัตรจากข้อความในช่อง "วันที่บัตรหมดอายุ" — ใช้ฟังก์ชันเดียวกับ API (`cardStatus` · `parseThaiDate`)
 * แค่แจ้ง ไม่บล็อกการบันทึก (ระบบเดิมบันทึกได้ทุกค่า · ด่านจริงอยู่ที่ /buy)
 */
export function expiryPreview(text: string, today: string): { status: CardStatus; message: Message } {
  const status = cardStatus(text, today);
  if (status !== "ok") return { status, message: { key: `card.preview.${status}` } };
  const iso = parseThaiDate(text);
  return {
    status,
    message: iso
      ? { key: "card.preview.validUntil", vars: { date: formatThaiDate(iso, "long") } }
      : { key: "card.lifetime" },
  };
}

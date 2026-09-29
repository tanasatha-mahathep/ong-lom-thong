import { expect } from "vitest";
import { cardFormat } from "./synthetic";

/**
 * เลขบัตรประชาชนเต็มในข้อความ (R13 · CLAUDE.md กฎ 7) — ติดกัน 13 หลัก · เว้นวรรคแบบหน้าบัตร · ขีดแบบหน้าบัตร
 * (?<!\d) … (?!\d) = ต้องเป็น 13 หลักพอดี · uuid มี hex ติดกันไม่เกิน 12 ตัวและกลุ่มไม่ตรงรูปหน้าบัตร จึงไม่จับผิด
 * เลขที่มาสก์แล้ว ("1 XXXX XXXXX 45 8") ไม่เข้ารูปนี้
 */
export const NATIONAL_ID_IN_TEXT = /(?<!\d)(?:\d{13}|\d \d{4} \d{5} \d{2} \d|\d-\d{4}-\d{5}-\d{2}-\d)(?!\d)/g;

/** เลขบัตรเต็มทุกตัวที่พบในข้อความ (เช่น response ที่ serialize แล้ว หรือ JSON ของ audit_log) */
export function nationalIdsIn(text: string): string[] {
  return [...text.matchAll(NATIONAL_ID_IN_TEXT)].map((m) => m[0]);
}

/**
 * ข้อความต้องไม่มีเลขบัตรเต็ม — ทั้งเลขใดก็ตามที่เข้ารูป 13 หลัก และเลขที่เทสต์รู้ว่าสร้างไว้ (`known`)
 * ซึ่งตรวจแบบ substring ทุกรูปแบบ (กันกรณีเลขถูกต่อท้ายตัวเลขอื่นจนหลุด regex)
 * `allow` = เลข 13 หลักที่ไม่ใช่เลขของบุคคล เช่น เลขผู้เสียภาษีของร้าน (นิติบุคคล) ที่ต้องพิมพ์บนใบรับซื้อ — ระบุทีละเลข
 */
export function expectNoNationalId(
  text: string,
  where: string,
  known: readonly string[] = [],
  allow: readonly string[] = [],
): void {
  const found = nationalIdsIn(text).filter((id) => !allow.includes(id.replace(/[\s-]/g, "")));
  expect(found, `${where}: พบเลขบัตรเต็มใน response`).toEqual([]);
  for (const id of known) {
    for (const form of [id, cardFormat(id, " "), cardFormat(id, "-")]) {
      expect(text.includes(form), `${where}: พบเลขบัตร ${form}`).toBe(false);
    }
  }
}

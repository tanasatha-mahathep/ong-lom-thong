import { useState } from "react";
import { looksLikeNationalId } from "./sensitive-query";

/** ค่าค้นที่หน้าค้นอ่านจาก URL — `q` ว่าง = ไม่มีคำค้น · `page` เริ่มที่ 1 */
export interface UrlSearch {
  q: string;
  page: number;
}

/**
 * เลขบัตรที่กำลังค้นอยู่ — อยู่ใน state ของหน้าเท่านั้น ไม่ลง URL (ประวัติเบราว์เซอร์/ลิงก์ที่แชร์)
 * URL ของการค้นแบบนี้จึงมี q ว่างเสมอ · `page` ตามหน้าที่ URL แสดง แต่ตั้งพร้อม state (ดู `hold`)
 */
export interface HeldQuery {
  q: string;
  page: number;
}

/**
 * ถือเลขบัตรที่พิมพ์ค้นไว้ใน state แทน URL (หน้าค้นบิล · ค้นลูกค้า ใช้ร่วมกัน) — ตัวหน้าเองยังต้อง navigate ล้าง ?q= ใน URL
 * - `hold(q)` เก็บเลขบัตรแล้วไปหน้า 1 ทันที: คำขอค้นจึงเป็น "เลขบัตร + หน้า 1" ตั้งแต่ครั้งแรก
 *   ไม่ต้องรอ URL ตามมา (ไม่งั้นค้นจากหน้า 3 จะยิง "เลขบัตร + หน้า 3" ก่อน)
 * - URL เปลี่ยนจากภายนอก (ปุ่มย้อนกลับ/ไปข้างหน้าของ browser · ลิงก์) พร้อม q → q ใน URL ชนะเลขบัตรที่ค้างอยู่
 *   ไม่งั้นช่องกับผลยังเป็นเลขบัตรทั้งที่ URL บอกอย่างอื่น · URL ที่มี q เป็นเลขบัตรเอง (ลิงก์เก่า/บุ๊กมาร์ก) ถูกเก็บไว้แทน
 * - ที่หน้านี้ทำเอง (ค้นด้วยเลขบัตร · เปลี่ยนหน้า) URL มาถึงด้วย q ว่างเสมอ จึงแค่ตามเลขหน้า
 * - เทียบตอน URL "เปลี่ยน" เท่านั้น ไม่เทียบทุก render: ช่วงที่ router ยังไม่ทันใช้ URL ใหม่ URL ยังเป็นค่าเก่า
 *   ซึ่งไม่ใช่การเปลี่ยนจากภายนอก · ปรับ state ระหว่าง render ตามแบบของ React ("adjusting state when a prop changes")
 */
export function useHeldQuery(url: UrlSearch) {
  const [held, setHeld] = useState<HeldQuery | undefined>(() =>
    looksLikeNationalId(url.q) ? { q: url.q, page: url.page } : undefined,
  );
  const [seen, setSeen] = useState({ q: url.q, page: url.page });
  if (seen.q !== url.q || seen.page !== url.page) {
    setSeen({ q: url.q, page: url.page });
    if (looksLikeNationalId(url.q)) setHeld({ q: url.q, page: url.page });
    else if (held) setHeld(url.q === "" ? { ...held, page: url.page } : undefined);
  }
  return {
    held,
    /** เก็บเลขบัตรที่พิมพ์ค้น แล้วไปหน้า 1 */
    hold: (q: string) => setHeld({ q, page: 1 }),
    /** เลิกถือ — คำค้นปกติ · ล้างช่อง · ล้างตัวกรอง */
    release: () => setHeld(undefined),
    /** เปลี่ยนหน้าผลค้นของเลขบัตรที่ถืออยู่ (ไม่ได้ถือ = ไม่ทำอะไร) */
    setPage: (page: number) => setHeld((current) => current && { ...current, page }),
  };
}

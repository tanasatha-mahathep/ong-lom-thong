import { useState } from "react";

/** ข้อความในช่องกรอกที่ค่าจริงอยู่ใน URL */
export interface UrlDraft {
  /** ข้อความในช่อง (ยังไม่ได้ส่งเข้า URL ก็ได้) */
  text: string;
  /** error ของข้อความที่พิมพ์ — ยังไม่ส่ง */
  error: string | undefined;
  /** ผู้ใช้พิมพ์ — ล้าง error เดิม */
  edit: (text: string) => void;
  fail: (error: string) => void;
  /** ช่องนี้กำลังส่ง `value` เข้า URL · `text` = ข้อความที่จัดรูปแล้ว (ไม่ส่ง = คงที่พิมพ์) */
  commit: (value: string, text?: string) => void;
  /** ตั้งค่าจากนอกช่อง (ปุ่มช่วงวันที่ · ล้างตัวกรอง) พร้อมกับ navigate */
  reset: (value: string) => void;
}

interface DraftState {
  text: string;
  error: string | undefined;
  /** ค่าใน URL ที่เห็นล่าสุด */
  seen: string;
  /** ค่าที่ช่องนี้เพิ่งส่งเข้า URL (ยังไม่เห็นกลับมา) */
  committed: string | null;
}

/**
 * ช่องกรอกที่ผูกกับค่าใน URL — พิมพ์ได้อิสระ ส่งเข้า URL เมื่อ commit
 * URL เปลี่ยนเพราะช่องนี้เอง (ค่าที่เพิ่ง commit หรือค่าเดียวกับที่พิมพ์อยู่) → คงข้อความ ไม่ทับที่กำลังพิมพ์ต่อ
 * URL เปลี่ยนจากที่อื่น (เมนูค้นบิล · ย้อนกลับ · ลิงก์) → ข้อความตามค่าใหม่
 * ปรับ state ระหว่าง render ตามแบบของ React ("adjusting state when a prop changes") — ไม่ใช้ effect ที่ setState
 *
 * @param value ค่าใน URL ("" = ไม่มี)
 * @param toText ค่า → ข้อความในช่อง
 * @param valueOf ข้อความ → ค่าที่จะส่ง (อ่านไม่ได้ = null)
 */
export function useUrlDraft(
  value: string,
  toText: (value: string) => string,
  valueOf: (text: string) => string | null,
): UrlDraft {
  const [draft, setDraft] = useState<DraftState>(() => ({
    text: toText(value),
    error: undefined,
    seen: value,
    committed: null,
  }));

  if (draft.seen !== value) {
    const own = value === draft.committed || value === valueOf(draft.text);
    setDraft(
      own
        ? { ...draft, seen: value, committed: null }
        : { text: toText(value), error: undefined, seen: value, committed: null },
    );
  }

  return {
    text: draft.text,
    error: draft.error,
    edit: (text) => setDraft((d) => ({ ...d, text, error: undefined })),
    fail: (error) => setDraft((d) => ({ ...d, error })),
    commit: (next, text) => setDraft((d) => ({ ...d, text: text ?? d.text, error: undefined, committed: next })),
    reset: (next) => setDraft((d) => ({ ...d, text: toText(next), error: undefined, committed: next })),
  };
}

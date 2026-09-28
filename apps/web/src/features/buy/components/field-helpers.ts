import type { KeyboardEvent } from "react";

/** รวม id ของคำอธิบาย/ข้อผิดพลาดที่มีอยู่จริง สำหรับ aria-describedby */
export function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const present = ids.filter((id): id is string => !!id);
  return present.length > 0 ? present.join(" ") : undefined;
}

/** Enter เปล่า ๆ (ไม่ใช่ Ctrl/⌘+Enter ที่แปลว่าบันทึก · ไม่ใช่ Shift+Enter ขึ้นบรรทัด · ไม่ใช่ระหว่างพิมพ์แบบ IME) */
export function isPlainEnter(e: KeyboardEvent): boolean {
  return e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing;
}

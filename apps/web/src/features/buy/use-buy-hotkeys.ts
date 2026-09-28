import { useEffect, useEffectEvent } from "react";

/** กลับมาที่แท็บนี้ซ้ำภายในช่วงนี้ (focus + visibilitychange มาคู่กัน) = ครั้งเดียว */
const RETURN_DEBOUNCE_MS = 500;

/**
 * ปุ่มลัดทั้งหน้า /buy และการ "กลับมาที่แท็บ"
 * - Ctrl+Enter / ⌘+Enter = บันทึก (จับที่ window ช่วง capture ก่อนช่องใดจะได้ Enter · ข้ามตอนพิมพ์ภาษาแบบ IME และตอนมี dialog)
 * - กลับมาจากแท็บอื่น (แก้ข้อมูลลูกค้า / เพิ่มลูกค้าใหม่) → onReturn — TanStack Query v5 ฟังแค่ visibilitychange จึงฟัง focus เพิ่ม
 */
export function useBuyHotkeys({ onSave, onReturn }: { onSave: () => void; onReturn: () => void }) {
  const save = useEffectEvent(onSave);
  const returned = useEffectEvent(onReturn);

  useEffect(() => {
    let last = -Infinity;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.isComposing) return;
      if (document.querySelector('[role="alertdialog"], [role="dialog"]')) return;
      event.preventDefault();
      event.stopPropagation();
      save();
    };
    const onBack = () => {
      if (document.visibilityState !== "visible") return;
      const now = performance.now();
      if (now - last < RETURN_DEBOUNCE_MS) return;
      last = now;
      returned();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("focus", onBack);
    document.addEventListener("visibilitychange", onBack);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("focus", onBack);
      document.removeEventListener("visibilitychange", onBack);
    };
  }, []);
}

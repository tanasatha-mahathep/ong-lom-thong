import { useMemo, useRef } from "react";

/**
 * onOpenAutoFocus ของ Sheet/Dialog — โฟกัสช่องที่ติด `data-autofocus` แทน element แรก (เช่น ช่องรหัสสาขาที่แก้ไม่ได้)
 * ไม่ใช้ `autoFocus` ของ React: Radix จะจำช่องนั้นเป็น "element ก่อนเปิด" แล้วคืนโฟกัสผิดที่ตอนปิด
 */
export function focusMarkedField(event: Event) {
  const container = event.currentTarget;
  if (!(container instanceof HTMLElement)) return;
  const target = container.querySelector<HTMLElement>("[data-autofocus]");
  if (!target) return;
  event.preventDefault();
  target.focus();
}

/**
 * Sheet/Dialog ที่เปิดด้วย state (ไม่มี Radix Trigger) — Radix คืนโฟกัสให้ Trigger เท่านั้น
 * จึงจำปุ่มที่เปิดไว้แล้วคืนเองใน onCloseAutoFocus · ปุ่มหายไปแล้ว (แถวถูกกรองออก) = กลับไปที่ <main>
 */
export function useReturnFocus() {
  const origin = useRef<HTMLElement | null>(null);
  const handedOff = useRef(false);
  return useMemo(
    () => ({
      /** ปุ่ม/ลิงก์ที่กดเปิด */
      remember: (element: HTMLElement | null) => {
        origin.current = element;
      },
      /** dialog ถัดไปรับโฟกัสต่อ (ฟอร์ม → รหัสผ่านชั่วคราว) — การปิดครั้งถัดไปไม่ต้องคืนโฟกัส */
      handOff: () => {
        handedOff.current = true;
      },
      /** ใส่ใน onCloseAutoFocus */
      restore: (event: Event) => {
        event.preventDefault();
        if (handedOff.current) {
          handedOff.current = false;
          return;
        }
        const element = origin.current;
        (element?.isConnected ? element : document.getElementById("main"))?.focus();
      },
    }),
    [],
  );
}

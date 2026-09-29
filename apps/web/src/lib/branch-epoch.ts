import { useSyncExternalStore } from "react";

/**
 * รุ่นของเนื้อหาหน้า — `<Outlet key>` ใน _app.tsx · เพิ่มเมื่อแอปตั้งใจล้างหน้า (สลับสาขาสำเร็จ)
 * ไม่ผูกกับ me.branch ตรง ๆ: สาขาที่เปลี่ยนจากที่อื่น (แท็บอื่น) ต้องไม่ล้างฟอร์มที่กรอกค้างเงียบ ๆ
 */
let epoch = 0;
const listeners = new Set<() => void>();

export function bumpContentEpoch(): void {
  epoch += 1;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useContentEpoch(): number {
  return useSyncExternalStore(
    subscribe,
    () => epoch,
    () => 0,
  );
}

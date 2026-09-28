import { useEffect, useState } from "react";

/** ค่าเดิมจนกว่า `value` จะนิ่งครบ `delayMs` — หน่วง live preview (quote) ไม่ให้ยิง API ทุกตัวอักษร */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

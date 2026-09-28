import { businessDate } from "@ong/core";
import { useEffect, useState } from "react";

/**
 * "วันนี้" ตามเวลาไทย (ISO "YYYY-MM-DD") ด้วย `businessDate()` ตัวเดียวกับ API
 * ตรวจทุกนาที — หน้าที่เปิดค้างข้ามเที่ยงคืนเปลี่ยนเป็นวันใหม่เอง ไม่ค้างยอดของเมื่อวาน
 */
export function useBusinessDate(): string {
  const [today, setToday] = useState(() => businessDate());
  useEffect(() => {
    const timer = setInterval(() => setToday(businessDate()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return today;
}

import { z } from "zod";

/**
 * CSP ของแอป (script-src 'self' ไม่มี 'unsafe-eval') บล็อก `new Function` ที่ zod v4 ใช้ทดสอบ/compile schema
 * — ปิด JIT ให้ zod ไม่ลองเลย (ไม่มี error/CSP violation ใน console) · ต้อง import เป็นบรรทัดแรกของ main.tsx
 * เพราะ schema ระดับ module ถูกสร้างตอน import
 */
z.config({ jitless: true });

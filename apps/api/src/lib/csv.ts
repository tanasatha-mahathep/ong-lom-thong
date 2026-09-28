/**
 * CSV สำหรับเปิดใน Excel ภาษาไทย — UTF-8 นำหน้าด้วย BOM (ไม่มี BOM Excel อ่านไทยเพี้ยน) · บรรทัดจบด้วย CRLF
 * · ใส่ "…" เฉพาะช่องที่มี , " หรือขึ้นบรรทัด (RFC 4180)
 */
export const CSV_BOM = "﻿";

// Excel ตีความช่องที่ขึ้นต้นด้วยตัวเหล่านี้เป็นสูตร (รวมแบบเต็มความกว้าง) — OWASP "CSV injection"
const FORMULA_START = /^[=+\-@\t\r＝＋－＠]/;

/**
 * ช่องข้อความ (ชื่อลูกค้า · สาขา · ผู้บันทึก — มาจากคนพิมพ์) — ขึ้นต้นเหมือนสูตรให้นำหน้าด้วย ' ให้ Excel เห็นเป็นข้อความ
 * ห้ามใช้กับช่องตัวเลขที่ระบบสร้างเอง (เงิน/น้ำหนักจาก decimal.js) — "-1.000" ต้องยังเป็นตัวเลขใน Excel
 */
export const csvText = (value: string | null | undefined): string => {
  const s = value ?? "";
  return FORMULA_START.test(s) ? `'${s}` : s;
};

const quote = (cell: string) => (/[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell);

/** ตาราง → เนื้อไฟล์ CSV (BOM + CRLF) — เซลล์ต้องผ่าน csvText มาแล้วถ้าเป็นข้อความจากผู้ใช้ */
export const toCsv = (rows: readonly (readonly string[])[]): string =>
  `${CSV_BOM}${rows.map((row) => row.map(quote).join(",")).join("\r\n")}\r\n`;

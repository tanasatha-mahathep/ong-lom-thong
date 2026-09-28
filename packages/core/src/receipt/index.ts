// @ong/core/receipt — ใบรับซื้อ A4 + สำเนาบัตร (React) · แยก subpath เพื่อให้ @ong/core หลักไม่ต้องมี React
export { Receipt } from "./Receipt";
export { IdCardCopy } from "./IdCardCopy";
export { renderReceiptHtml, renderIdCardHtml } from "./render";
export type { ReceiptData, IdCardCopyData, RenderHtmlOptions } from "./types";
// ข้อมูลเอกสารผิด = ความล้มเหลวถาวร (งาน PDF ไม่ต้อง retry) — class เดียวกับที่ export จาก @ong/core
export { ReceiptDataError } from "../errors";

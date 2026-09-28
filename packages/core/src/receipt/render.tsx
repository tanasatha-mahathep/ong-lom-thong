/** @jsxRuntime automatic @jsxImportSource react */
// pragma: ผู้ bundle ที่ใช้ tsconfig ของตัวเอง (tsup ของ apps/api) ก็ยังได้ JSX runtime อัตโนมัติ ไม่ใช่ React.createElement
import { renderToStaticMarkup } from "react-dom/server";
import { D, ZERO } from "../money";
import { IdCardCopy } from "./IdCardCopy";
import { Receipt } from "./Receipt";
import { DOCUMENT_CSS, fontFaceCss } from "./styles";
import type { IdCardCopyData, ReceiptData, RenderHtmlOptions } from "./types";

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function htmlDocument(title: string, body: string, opts: RenderHtmlOptions): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="th">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>\n${fontFaceCss(opts.fontBaseUrl ?? "/fonts")}\n${DOCUMENT_CSS}\n</style>`,
    "</head>",
    `<body>${body}</body>`,
    "</html>",
    "",
  ].join("\n");
}

/**
 * PDF เก็บถาวรต้องไม่มีตัวเลขขัดกันเอง — Σรายการ และ Σชำระ ต้องเท่ายอดบิล (R4)
 * DB บังคับไว้แล้ว ตัวนี้กันบั๊กตอน map ข้อมูล: พังดัง ๆ (pdf_status = failed) ดีกว่าเก็บใบผิดไว้ 5 ปี
 */
function assertTotals(data: ReceiptData): void {
  const total = D(data.totalAmount);
  const lines = data.lines.reduce((sum, l) => sum.plus(D(l.amount)), ZERO);
  const paid = data.payments.reduce((sum, p) => sum.plus(D(p.amount)), ZERO);
  if (!lines.eq(total)) {
    throw new Error(`ใบรับซื้อ ${data.docNo}: รวมรายการ ${lines.toFixed(2)} ไม่เท่ายอดบิล ${total.toFixed(2)}`);
  }
  if (!paid.eq(total)) {
    throw new Error(`ใบรับซื้อ ${data.docNo}: รวมชำระ ${paid.toFixed(2)} ไม่เท่ายอดบิล ${total.toFixed(2)}`);
  }
}

/** ไฟล์ HTML เต็ม (A4 ตั้ง) ของใบรับซื้อ — ส่งเข้า Gotenberg เป็น index.html */
export function renderReceiptHtml(data: ReceiptData, opts: RenderHtmlOptions = {}): string {
  assertTotals(data);
  const title = `ใบรับซื้อของเก่า ${data.docNo}${data.status === "void" ? " (ยกเลิก)" : ""}`;
  return htmlDocument(title, renderToStaticMarkup(<Receipt data={data} />), opts);
}

/** ไฟล์ HTML เต็ม (A4 ตั้ง) ของสำเนาบัตรประชาชน — แยกไฟล์จากใบรับซื้อ */
export function renderIdCardHtml(data: IdCardCopyData, opts: RenderHtmlOptions = {}): string {
  return htmlDocument(`สำเนาบัตรประชาชน ${data.docNo}`, renderToStaticMarkup(<IdCardCopy data={data} />), opts);
}

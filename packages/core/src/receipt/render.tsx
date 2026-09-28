/** @jsxRuntime automatic @jsxImportSource react */
// pragma: ผู้ bundle ที่ใช้ tsconfig ของตัวเอง (tsup ของ apps/api) ก็ยังได้ JSX runtime อัตโนมัติ ไม่ใช่ React.createElement
import { renderToStaticMarkup } from "react-dom/server";
import { IdCardCopy } from "./IdCardCopy";
import { Receipt } from "./Receipt";
import { DOCUMENT_CSS, fontFaceCss } from "./styles";
import type { IdCardCopyData, ReceiptData, RenderHtmlOptions } from "./types";
import { requireTaxBranchLabel } from "./validate";

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
 * ไฟล์ HTML เต็ม (A4 ตั้ง) ของใบรับซื้อ — ส่งเข้า Gotenberg เป็น index.html
 * ข้อมูลผิดทุกกรณี = ReceiptDataError (ความล้มเหลวถาวร ไม่ต้อง retry): ยอดไม่ตรง · วันที่ · ตัวเลข ·
 * ไม่มี/ผิดรูป tax_branch_code (PDF เท่านั้นที่บังคับต้องมี — เอกสารถาวรห้ามไม่มีป้ายสาขา)
 */
export function renderReceiptHtml(data: ReceiptData, opts: RenderHtmlOptions = {}): string {
  requireTaxBranchLabel(data);
  const title = `ใบรับซื้อของเก่า ${data.docNo}${data.status === "void" ? " (ยกเลิก)" : ""}`;
  return htmlDocument(title, renderToStaticMarkup(<Receipt data={data} />), opts);
}

/** ไฟล์ HTML เต็ม (A4 ตั้ง) ของสำเนาบัตรประชาชน — แยกไฟล์จากใบรับซื้อ */
export function renderIdCardHtml(data: IdCardCopyData, opts: RenderHtmlOptions = {}): string {
  return htmlDocument(`สำเนาบัตรประชาชน ${data.docNo}`, renderToStaticMarkup(<IdCardCopy data={data} />), opts);
}

/**
 * CSS ของใบพิมพ์ — ขนาดทั้งหมดขยาย √2 จากต้นฉบับ A5 (Django print/buy_receipt.html ที่เทียบใบจริง RC6909-0010)
 * ให้สัดส่วนบน A4 ตั้งเท่าเดิม (ใบรับซื้อพิมพ์ A5 ด้วยการย่อ 1/√2 ตอนพิมพ์) · ทุก selector อยู่ใต้ .ong-receipt / .ong-idcard จึงไม่ชนกับ CSS ของเว็บ
 * @page อยู่ในนี้ด้วย เพื่อให้ window.print() ของหน้าเว็บได้ A5 ตั้งเหมือน PDF
 */

const FONT_STACK = `"Sarabun", "TH Sarabun New", "THSarabunPSK", "Garuda", "Kinnari", sans-serif`;

const PAGE = `@page { size: A4 portrait; margin: 12mm 14mm; }`;

/**
 * ใบรับซื้อพิมพ์บน A5 แนวตั้ง (ใบใหม่ทุกใบตั้งแต่ 3 ต.ค. 2569 · PDF ที่เก็บไว้แล้วไม่แก้)
 * ตอนพิมพ์ย่อเนื้อหา 1/√2 จากขนาด A4 ที่ออกแบบไว้ (ต้นฉบับ A5 จริง) · จอยังแสดงขนาดเดิม (กว้างไม่เกิน 190 mm)
 */
const PAGE_A5 = `@page { size: A5 portrait; margin: 8.5mm 10mm; }`;
/** 1/√2 ของขนาดบนจอ · กว้าง 181 mm × 0.70711 = 128 mm = ความกว้างเนื้อหาของ A5 (148 − 2 × 10) */
const PRINT_SCALE_A5 = `@media print { .ong-receipt { zoom: 0.70711; width: 181mm; max-width: none; } }`;

/** ลายน้ำระบบทดสอบ — ทับทั้งเอกสารแนวทแยง จางพอให้อ่านข้อมูลได้ แต่ถ่ายเอกสารก็ยังเห็น */
const WATERMARK = `.ong-watermark { position: absolute; inset: 0; z-index: 3; display: flex; align-items: center;
  justify-content: center; overflow: hidden; pointer-events: none; }
.ong-watermark span { transform: rotate(-30deg); font-size: 24pt; font-weight: 700; white-space: nowrap;
  color: rgba(200, 0, 0, 0.25); border: 3px solid rgba(200, 0, 0, 0.25); padding: 3mm 8mm; }
/* พิมพ์: fixed = ซ้ำทุกหน้า (ใบยาวเกินหนึ่งหน้าก็ยังมีลายน้ำทุกแผ่น) */
@media print { .ong-watermark { position: fixed; } }`;

export const RECEIPT_CSS = `${PAGE_A5}
${PRINT_SCALE_A5}
${WATERMARK}
.ong-receipt { position: relative; box-sizing: border-box; width: 100%; max-width: 190mm; margin: 0 auto;
  background: #fff; color: #000; font-family: ${FONT_STACK}; font-size: 13.5px; font-weight: 400; line-height: 1.45;
  font-variant-numeric: tabular-nums; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.ong-receipt *, .ong-receipt *::before, .ong-receipt *::after { box-sizing: border-box; }
.ong-receipt b { font-weight: 700; }
.ong-receipt .company { text-align: center; line-height: 1.5; }
.ong-receipt .company .name { font-size: 18.5px; font-weight: 700; }
.ong-receipt .doctitle { text-align: center; font-size: 17px; font-weight: 700; margin: 10px 0 6px; }
.ong-receipt .row { display: flex; justify-content: space-between; gap: 12px; }
.ong-receipt .seller { line-height: 1.55; margin: 6px 0 8px; overflow-wrap: anywhere; }
.ong-receipt hr { height: 0; border: none; border-top: 1px solid #000; margin: 6px 0; }
.ong-receipt table { border-collapse: collapse; border-spacing: 0; }
.ong-receipt table.items { width: 100%; }
.ong-receipt table.items th, .ong-receipt table.items td { padding: 4px 6px; }
.ong-receipt th { text-align: center; }
.ong-receipt table.items th { font-weight: 400; border-bottom: 1px solid #000; }
.ong-receipt .c { text-align: center; }
.ong-receipt .r { text-align: right; }
.ong-receipt .note { margin: 6px 0 11px; white-space: pre-line; overflow-wrap: anywhere; }
.ong-receipt .words { text-align: center; margin: 8px 0 14px; }
.ong-receipt .words .lab { display: inline-block; width: 127px; text-align: left; }
.ong-receipt .bottom { display: flex; gap: 14px; align-items: flex-start; break-inside: avoid; }
.ong-receipt .cert { flex: 0 0 56%; text-align: center; font-size: 12px; line-height: 1.55; white-space: nowrap; }
.ong-receipt .pay { flex: 1 1 0; min-width: 0; }
.ong-receipt .pay .title { text-align: center; margin-bottom: 3px; }
.ong-receipt table.paytb { width: 100%; font-size: 12.5px; }
.ong-receipt table.paytb th, .ong-receipt table.paytb td { border: 1px solid #000; padding: 3px 6px; text-align: center; }
.ong-receipt table.paytb th { font-weight: 700; }
.ong-receipt table.paytb td.r { text-align: right; }
.ong-receipt .signrow { display: flex; justify-content: space-between; margin-top: 10px; font-size: 12.5px;
  text-align: center; break-inside: avoid; }
.ong-receipt .signrow > div { width: 48%; }
.ong-receipt .signline { margin-top: 38px; border-top: 1px dotted #333; padding-top: 3px; }
.ong-receipt .void-note { margin: 2px 0 8px; padding: 4px 10px; border: 1.5px solid #c62828; color: #c62828;
  text-align: center; font-weight: 700; white-space: pre-line; overflow-wrap: anywhere; }
.ong-receipt .void-stamp { position: absolute; left: 50%; top: 44%; z-index: 1; transform: translate(-50%, -50%) rotate(-18deg);
  padding: 0 34px; border: 7px double #c62828; border-radius: 12px; color: #c62828; font-size: 76px; font-weight: 700;
  line-height: 1.3; letter-spacing: 8px; white-space: nowrap; opacity: 0.55; pointer-events: none; }
`;

export const IDCARD_CSS = `${PAGE}
${WATERMARK}
.ong-idcard { position: relative; }
.ong-idcard { box-sizing: border-box; width: 100%; max-width: 190mm; margin: 0 auto; background: #fff; color: #000;
  font-family: ${FONT_STACK}; font-size: 13.5px; font-weight: 400; line-height: 1.45;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.ong-idcard *, .ong-idcard *::before, .ong-idcard *::after { box-sizing: border-box; }
.ong-idcard b { font-weight: 700; }
.ong-idcard .company { text-align: center; font-size: 18.5px; font-weight: 700; }
.ong-idcard .doctitle { text-align: center; font-size: 17px; font-weight: 700; margin: 6px 0 8px; }
.ong-idcard .row { display: flex; justify-content: space-between; gap: 12px; }
.ong-idcard .photo { position: relative; width: 150mm; max-width: 100%; height: 95mm; margin: 10mm auto 6mm; overflow: hidden; }
.ong-idcard .photo img { display: block; width: 100%; height: 100%; object-fit: contain; }
.ong-idcard .watermark { position: absolute; left: 50%; top: 50%; width: 125mm; transform: translate(-50%, -50%) rotate(-20deg);
  text-align: center; color: #d64545; opacity: 0.55; font-size: 25px; font-weight: 700; line-height: 1.7; pointer-events: none; }
.ong-idcard .purpose { text-align: center; font-size: 16px; font-weight: 700; overflow-wrap: anywhere; }
`;

/** สไตล์ระดับเอกสาร (เฉพาะไฟล์ HTML เต็มที่ส่งเข้า Gotenberg) */
export const DOCUMENT_CSS = `html, body { margin: 0; padding: 0; background: #fff; }`;

/**
 * @font-face ของ Sarabun จาก fontBaseUrl — "" = relative ("Sarabun-Regular.ttf")
 * มี local() สำรอง: image ของ Gotenberg ติดตั้ง Sarabun ไว้แล้ว ถ้าไฟล์หายก็ยังพิมพ์ไทยได้
 */
export function fontFaceCss(fontBaseUrl: string): string {
  if (/["'`\\()<>\s]/.test(fontBaseUrl)) {
    // ค่าตั้งของระบบ ไม่ใช่ข้อมูลบิล — จึงไม่ใช่ ReceiptDataError (แก้ config แล้ว retry ได้)
    throw new TypeError(`fontBaseUrl มีอักขระที่ใส่ใน CSS url() ไม่ได้: ${fontBaseUrl}`);
  }
  const url = (file: string) =>
    fontBaseUrl === "" ? file : fontBaseUrl.endsWith("/") ? `${fontBaseUrl}${file}` : `${fontBaseUrl}/${file}`;
  const face = (file: string, local: string, weight: number) =>
    `@font-face { font-family: "Sarabun"; src: url("${url(file)}") format("truetype"), local("${local}"), ` +
    `local("${local.replace(" ", "-")}"); font-weight: ${weight}; font-style: normal; }`;
  return `${face("Sarabun-Regular.ttf", "Sarabun Regular", 400)}\n${face("Sarabun-Bold.ttf", "Sarabun Bold", 700)}`;
}

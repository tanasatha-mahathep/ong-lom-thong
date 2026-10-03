import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IdCardCopy, Receipt, ReceiptDataError, renderIdCardHtml, renderReceiptHtml, type ReceiptData } from "./index";

// ข้อมูลร้านจากหน้าตั้งค่าบริษัทของระบบเดิม (raw/company.html) · ลูกค้าเป็นข้อมูลสมมติ (เลขบัตร checksum ถูก)
const company = {
  name: "โอเอ็นจี หลอมทอง",
  address: "156/7 ถนนพังงา ตำบลตลาดใหญ่ อำเภอเมืองภูเก็ต จังหวัดภูเก็ต 83000",
  tel: "0654249514",
  fax: "-",
  taxId: "3839900461751",
};

/** จำลองใบจริง RC6909-0010 — ทอง 3 %เนื้อ รวม 5.860 ก. 20,030.00 บาท */
function rc6909(over: Partial<ReceiptData> = {}): ReceiptData {
  return {
    company,
    branch: { name: "สำนักงานใหญ่", taxBranchCode: "00000" },
    docNo: "RC6909-0010",
    date: "2026-09-02",
    time: "10:15",
    customer: {
      nameTh: "นาย ทดสอบ ระบบ",
      address: "99/9 ตำบลทดสอบ อำเภอทดสอบ จังหวัดภูเก็ต",
      nationalId: "1670101304032",
    },
    lines: [
      { metalName: "ทอง", weightG: "2.000", amount: "8000.00" },
      { metalName: "ทอง", weightG: "1.860", amount: "6000.00" },
      { metalName: "ทอง", weightG: "2.000", amount: "6030.00" },
    ],
    detail: "g 97% g 81% g 75%",
    totalAmount: "20030.00",
    payments: [{ label: "เงินสด", bank: null, amount: "20030.00" }],
    status: "active",
    ...over,
  };
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("renderReceiptHtml — ใบรับซื้อของเก่า/ใบสำคัญจ่าย A5", () => {
  it("เป็นเอกสาร HTML เต็ม A5 ตั้ง ภาษาไทย", () => {
    const html = renderReceiptHtml(rc6909());
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<html lang="th">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("@page { size: A5 portrait; margin: 8.5mm 10mm; }");
    expect(html).toContain("<title>ใบรับซื้อของเก่า RC6909-0010</title>");
  });

  it("ตอนพิมพ์ย่อใบ 1/√2 ให้เต็มความกว้าง A5 (จอไม่เปลี่ยน)", () => {
    const html = renderReceiptHtml(rc6909());
    expect(html).toContain("@media print { .ong-receipt { zoom: 0.70711; width: 181mm; max-width: none; } }");
    // ส่วนจอยังคงกว้างสูงสุด 190 mm เหมือนเดิม
    expect(html).toContain("max-width: 190mm;");
  });

  it("มีทุกช่วงของใบจริง RC6909-0010 (เช็กลิสต์จาก Django test_buy_receipt)", () => {
    const html = renderReceiptHtml(rc6909());
    for (const marker of [
      "ใบรับซื้อของเก่า/ใบสำคัญจ่าย",
      "โอเอ็นจี หลอมทอง",
      "จังหวัดภูเก็ต 83000 (สำนักงานใหญ่)",
      "โทร.0654249514 โทรสาร. -",
      "เลขประจำตัวผู้เสียภาษี 3839900461751",
      "วันที่ 2 กันยายน 2569",
      "RC6909-0010",
      "ชื่อผู้ขาย : นาย ทดสอบ ระบบ",
      "ที่อยู่ : 99/9 ตำบลทดสอบ อำเภอทดสอบ จังหวัดภูเก็ต",
      "เลขประจำตัวผู้เสียภาษี : 1670101304032", // เลขเต็มบน PDF ได้ (R13)
      "รายการสินค้าที่ขาย",
      "ราคาต่อหน่วย",
      "ราคารวมสินค้า",
      "รายละเอียด (ถ้ามี): g 97% g 81% g 75%",
      "สองหมื่นสามสิบบาทถ้วน",
      "วิธีการชำระเงิน",
      "ชื่อธนาคาร",
      "ข้าพเจ้า(ผู้ขาย)ขอรับรองว่าสิ่งของที่นำมาขายนั้นเป็นกรรมสิทธิ์โดยชอบ",
      "ข้าพเจ้าขอรับผิดชอบทั้งสิ้น โดยไม่มีข้อโต้แย้งทุกกรณี",
      "ผู้ขาย/รับรองสำเนาบัตรประชาชน/ผู้รับเงิน",
      "ผู้ซื้อ ในนาม โอเอ็นจี หลอมทอง",
    ]) {
      expect(html, marker).toContain(marker);
    }
  });

  it("บิลเก่า (ไม่มีค่าบริสุทธิ์) พิมพ์ชื่อโลหะอย่างเดียว 1 บรรทัดต่อโลหะ เหมือนใบจริง: 5.860 กรัม · 3,418.09 · 20,030.00", () => {
    const html = renderReceiptHtml(rc6909());
    expect(count(html, '<td class="c">ทอง</td>')).toBe(1);
    expect(html).toContain(
      '<td class="c">ทอง</td><td class="c">5.860</td><td class="c">กรัม</td>' +
        '<td class="r">3,418.09</td><td class="r">20,030.00</td>',
    );
    expect(html).toContain('<td>เงินสด</td><td>-</td><td class="r">20,030.00</td>');
  });

  it("หลายโลหะ หลายวิธีชำระ · สาขาอื่นพิมพ์ 'สาขาที่ 00001'", () => {
    const html = renderReceiptHtml(
      rc6909({
        branch: { name: "สาขา 2", taxBranchCode: "00001" },
        lines: [
          { metalName: "ทอง", weightG: "15.244", amount: "52100.00" },
          { metalName: "เงิน", weightG: "1250.500", amount: "37515.00" },
          { metalName: "ทอง", weightG: "0.756", amount: "2584.00" },
        ],
        totalAmount: "92199.00",
        payments: [
          { label: "เงินสด", bank: null, amount: "12199.00" },
          { label: "เงินโอน", bank: "กสิกรไทย", amount: "80000.00" },
        ],
      }),
    );
    expect(html).toContain("(สาขาที่ 00001)");
    expect(html).toContain('<td class="c">ทอง</td><td class="c">16.000</td><td class="c">กรัม</td>');
    expect(html).toContain('<td class="r">3,417.75</td><td class="r">54,684.00</td>');
    expect(html).toContain('<td class="c">เงิน</td><td class="c">1,250.500</td>');
    expect(html.indexOf(">ทอง<")).toBeLessThan(html.indexOf(">เงิน<"));
    expect(html).toContain('<td>เงินโอน</td><td>กสิกรไทย</td><td class="r">80,000.00</td>');
    expect(html).toContain("เก้าหมื่นสองพันหนึ่งร้อยเก้าสิบเก้าบาทถ้วน");
  });

  it("ตัวเลขทั้งใบเป็น decimal: 0.1 + 0.2 กรัม · 10.05 ÷ 2 = 5.03 (float ได้ 5.02)", () => {
    const html = renderReceiptHtml(
      rc6909({
        lines: [
          { metalName: "ทอง", weightG: "0.1", amount: "0.10" },
          { metalName: "ทอง", weightG: "0.2", amount: "0.20" },
          { metalName: "นาก", weightG: "2.000", amount: "10.05" },
        ],
        totalAmount: "10.35",
        payments: [{ label: "เงินสด", bank: null, amount: "10.35" }],
      }),
    );
    expect(html).toContain('<td class="c">0.300</td>');
    expect(html).toContain('<td class="r">5.03</td><td class="r">10.05</td>');
    expect(html).toContain("สิบบาทสามสิบห้าสตางค์");
    expect(html).not.toMatch(/0\.3000000|0\.30000000000000004|e[+-]\d/);
  });

  it("บิลใหม่พิมพ์ % บนใบ: 1 บรรทัดต่อ (โลหะ · ค่าบริสุทธิ์ · หัก %) · หัก 0 ไม่พิมพ์ · ตัวเลขจาก DB ตัดศูนย์ท้าย", () => {
    // ค่าบริสุทธิ์/หัก % ตามที่ DB คืน numeric(6,3)/(5,2) · ยอดคิดมือจากสูตร (ทองแท่งรับซื้อ 67,650 · เงิน 45/กรัม):
    // ทอง 96.5% หัก 3%: 10 ก. 41,535 + 2 ก. 8,307 = 49,842 ÷ 12 = 4,153.50 · ทอง 90% 1 ก.: ⌊4,437.84 × 0.9⌋ = 3,994
    // เงิน 92.5% 271.56 ก.: ⌊41 × 271.56⌋ = 11,133 ÷ 271.56 = 40.996… → 41.00 · รวม 64,969.00
    const graded = (
      metalName: string,
      purityPercent: string,
      deductPercent: string,
      weightG: string,
      amount: string,
    ) => ({
      metalName,
      weightG,
      amount,
      purityPercent,
      deductPercent,
    });
    const data = rc6909({
      lines: [
        graded("ทอง", "96.500", "3.00", "10.000", "41535.00"),
        graded("ทอง", "90.000", "0.00", "1.000", "3994.00"),
        graded("เงิน", "92.500", "0.00", "271.560", "11133.00"),
        graded("ทอง", "96.500", "3.00", "2.000", "8307.00"),
      ],
      detail: null,
      totalAmount: "64969.00",
      payments: [{ label: "เงินสด", bank: null, amount: "64969.00" }],
    });
    const html = renderReceiptHtml(data);
    const rows = [
      '<td class="c">ทอง 96.5% หัก 3%</td><td class="c">12.000</td><td class="c">กรัม</td>' +
        '<td class="r">4,153.50</td><td class="r">49,842.00</td>',
      '<td class="c">ทอง 90%</td><td class="c">1.000</td><td class="c">กรัม</td>' +
        '<td class="r">3,994.00</td><td class="r">3,994.00</td>',
      '<td class="c">เงิน 92.5%</td><td class="c">271.560</td><td class="c">กรัม</td>' +
        '<td class="r">41.00</td><td class="r">11,133.00</td>',
    ];
    for (const row of rows) expect(html, row).toContain(row);
    // เรียงตามที่กลุ่มปรากฏครั้งแรก · แถวที่ 4 รวมเข้ากลุ่มแรก ไม่พิมพ์ซ้ำ
    expect(rows.map((row) => html.indexOf(row))).toStrictEqual(
      rows.map((row) => html.indexOf(row)).sort((a, b) => a - b),
    );
    expect(count(html, '<td class="c">ทอง 96.5% หัก 3%</td>')).toBe(1);
    expect(count(html, '<td class="r">')).toBe(3 * 2 + 1); // 3 บรรทัดรายการ (ราคาต่อหน่วย · ราคารวม) + แถวชำระ 1
    expect(html).not.toMatch(/96\.500|3\.00%|หัก 0%/);
    expect(html).toContain("หกหมื่นสี่พันเก้าร้อยหกสิบเก้าบาทถ้วน");
    // หน้าเว็บ (<Receipt/>) พิมพ์บรรทัดชุดเดียวกัน
    const web = renderToStaticMarkup(<Receipt data={data} />);
    for (const row of rows) expect(web, row).toContain(row);
  });

  it("ชื่อรายการที่ต่อ % แล้วยัง escape ชื่อโลหะ (XSS ใน PDF/หน้าเว็บ)", () => {
    const html = renderReceiptHtml(
      rc6909({
        lines: [
          {
            metalName: "<img src=x onerror=alert(6)>",
            weightG: "5.860",
            amount: "20030.00",
            purityPercent: "96.500",
            deductPercent: "3.00",
          },
        ],
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain('<td class="c">&lt;img src=x onerror=alert(6)&gt; 96.5% หัก 3%</td>');
  });

  it("ค่าบริสุทธิ์เสีย → ReceiptDataError ทั้ง PDF และหน้าเว็บ (ไม่พิมพ์ % มั่ว)", () => {
    const bad = rc6909({
      lines: [{ metalName: "ทอง", weightG: "5.860", amount: "20030.00", purityPercent: "abc", deductPercent: "0" }],
    });
    expect(() => renderReceiptHtml(bad)).toThrow(ReceiptDataError);
    expect(() => renderToStaticMarkup(<Receipt data={bad} />)).toThrow(/ค่าบริสุทธิ์ไม่ใช่ตัวเลข/);
  });

  it("ชื่อว่างใช้ 'ลูกค้าทั่วไป' · ช่องว่างไม่พิมพ์ null/undefined", () => {
    const html = renderReceiptHtml(
      rc6909({
        customer: { nameTh: " ", address: null, nationalId: "1670101304032" },
        company: { ...company, fax: null },
        detail: null,
      }),
    );
    expect(html).toContain("ชื่อผู้ขาย : ลูกค้าทั่วไป");
    expect(html).toContain("ที่อยู่ : <br/>");
    expect(html).toContain("โทรสาร. -");
    expect(html).toContain("รายละเอียด (ถ้ามี): </div>");
    expect(html).not.toContain("null");
    expect(html).not.toContain("undefined");
  });

  it("ใบยกเลิก: ตรา 'ยกเลิก' + เหตุผล · ใบปกติไม่มีตรา", () => {
    const voided = renderReceiptHtml(rc6909({ status: "void", voidReason: "พนักงานกรอกน้ำหนักผิด" }));
    expect(voided).toContain('<div class="void-stamp">ยกเลิก</div>');
    expect(voided).toContain("ใบรับซื้อฉบับนี้ถูกยกเลิก · เหตุผล: พนักงานกรอกน้ำหนักผิด");
    expect(voided).toContain("<title>ใบรับซื้อของเก่า RC6909-0010 (ยกเลิก)</title>");

    const noReason = renderReceiptHtml(rc6909({ status: "void", voidReason: null }));
    expect(noReason).toContain('<div class="void-note">ใบรับซื้อฉบับนี้ถูกยกเลิก</div>');

    const active = renderReceiptHtml(rc6909());
    expect(active).not.toContain('class="void-stamp"');
    expect(active).not.toContain('class="void-note"');
    expect(active).not.toContain("ถูกยกเลิก");
  });

  it("escape ข้อความจากผู้ใช้ทุกช่อง (XSS ใน PDF/หน้าเว็บ)", () => {
    const html = renderReceiptHtml(
      rc6909({
        docNo: "RC</title><script>alert(1)</script>",
        company: { ...company, name: 'ร้าน<img src=x onerror="alert(2)">' },
        customer: {
          nameTh: "<script>alert(3)</script>",
          address: "<iframe src=//evil>",
          nationalId: "1670101304032",
        },
        detail: "<img src=x onerror=alert(4)>\n</div><b>ปลอม</b>",
        payments: [{ label: "<svg onload=alert(5)>", bank: "<u>", amount: "20030.00" }],
        status: "void",
        voidReason: "<style>*{display:none}</style>",
      }),
    );
    for (const raw of ["<script", "<img", "<iframe", "<svg", "<u>", "<b>ปลอม", "<style>*"]) {
      expect(html, raw).not.toContain(raw);
    }
    expect(html).toContain("&lt;script&gt;alert(3)&lt;/script&gt;");
    expect(html).toContain("RC&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("Σรายการ หรือ Σชำระ ไม่เท่ายอดบิล → ReceiptDataError (ไม่เก็บ PDF ที่ตัวเลขขัดกัน)", () => {
    const linesOff = rc6909({ totalAmount: "20030.01" });
    const paidOff = rc6909({ payments: [{ label: "เงินสด", bank: null, amount: "20000.00" }] });
    expect(() => renderReceiptHtml(linesOff)).toThrow(ReceiptDataError);
    expect(() => renderReceiptHtml(linesOff)).toThrow(/รวมรายการ 20030.00 ไม่เท่ายอดบิล 20030.01/);
    expect(() => renderReceiptHtml(paidOff)).toThrow(/รวมชำระ 20000.00 ไม่เท่ายอดบิล 20030.00/);
  });

  it("<Receipt/> บนเว็บ/พิมพ์ก็ตรวจยอดเหมือน PDF — ยอดไม่ตรงไม่แสดงใบ", () => {
    const mismatch = rc6909({ payments: [{ label: "เงินสด", bank: null, amount: "20000.00" }] });
    expect(() => renderToStaticMarkup(<Receipt data={mismatch} />)).toThrow(ReceiptDataError);
    expect(() => renderToStaticMarkup(<Receipt data={rc6909({ totalAmount: "20030.01" })} />)).toThrow(/รวมรายการ/);
  });

  it("PDF ไม่มีรหัสสาขาของสรรพากร → ReceiptDataError (fail-closed ห้ามพิมพ์รหัสชั่วคราว)", () => {
    for (const taxBranchCode of [null, "", "  "]) {
      const noCode = rc6909({ branch: { name: "สาขา 2", taxBranchCode } });
      expect(() => renderReceiptHtml(noCode)).toThrow(ReceiptDataError);
      expect(() => renderReceiptHtml(noCode)).toThrow(/สาขา 2.*tax_branch_code/);
    }
  });

  it("หน้าเว็บ (<Receipt/>) ไม่มีรหัสสาขา → แสดงได้แต่ไม่มีป้ายสาขา", () => {
    const html = renderToStaticMarkup(<Receipt data={rc6909({ branch: { name: "สาขา 2", taxBranchCode: null } })} />);
    expect(html).toContain("จังหวัดภูเก็ต 83000<br/>");
    expect(html).not.toContain("(สำนักงานใหญ่)");
    expect(html).not.toContain("(สาขาที่");
  });

  it("หน้าเว็บพิมพ์เลขบัตรตามที่ส่งมา — เว็บส่งเลขมาสก์ (R13) · PDF ส่งเลขเต็ม", () => {
    const masked = rc6909({ customer: { ...rc6909().customer, nationalId: "1 XXXX XXXXX 03 2" } });
    const html = renderToStaticMarkup(<Receipt data={masked} />);
    expect(html).toContain("เลขประจำตัวผู้เสียภาษี : 1 XXXX XXXXX 03 2");
    expect(html).not.toContain("1670101304032");
  });

  it("ข้อมูลเสียทุกแบบ → ReceiptDataError ทั้ง PDF และหน้าเว็บ (งาน PDF หยุด retry ได้)", () => {
    const bad: ReceiptData[] = [
      rc6909({ date: "2/9/2569" }),
      rc6909({ date: "2026-09-02T10:15:00Z" }),
      rc6909({ branch: { name: "x", taxBranchCode: "1" } }),
      rc6909({ totalAmount: "abc" }),
      rc6909({ lines: [{ metalName: "ทอง", weightG: "0", amount: "20030.00" }] }),
      rc6909({ lines: [], totalAmount: "0.00", payments: [] }),
    ];
    for (const data of bad) {
      expect(() => renderReceiptHtml(data)).toThrow(ReceiptDataError);
      expect(() => renderToStaticMarkup(<Receipt data={data} />)).toThrow(ReceiptDataError);
    }
  });

  it("ฟอนต์ Sarabun: ค่าเริ่มต้น /fonts · '' = relative สำหรับ Gotenberg · URL เต็มได้", () => {
    expect(renderReceiptHtml(rc6909())).toContain('url("/fonts/Sarabun-Regular.ttf")');
    const rel = renderReceiptHtml(rc6909(), { fontBaseUrl: "" });
    expect(rel).toContain('url("Sarabun-Regular.ttf")');
    expect(rel).toContain('url("Sarabun-Bold.ttf")');
    expect(renderReceiptHtml(rc6909(), { fontBaseUrl: "https://cdn.example/f/" })).toContain(
      'url("https://cdn.example/f/Sarabun-Bold.ttf")',
    );
    // ค่าตั้งของระบบ ไม่ใช่ข้อมูลบิล → ไม่ใช่ ReceiptDataError (แก้ config แล้ว retry ได้)
    const badFont = () => renderReceiptHtml(rc6909(), { fontBaseUrl: '/f");}</style><script>' });
    expect(badFont).toThrow(TypeError);
    expect(badFont).not.toThrow(ReceiptDataError);
  });

  it("<Receipt/> บนเว็บคือ markup ชุดเดียวกับใน PDF", () => {
    const data = rc6909();
    const component = renderToStaticMarkup(<Receipt data={data} />);
    expect(component.startsWith('<div class="ong-receipt">')).toBe(true);
    expect(renderReceiptHtml(data)).toContain(`<body>${component}</body>`);
  });
});

describe("renderIdCardHtml — สำเนาบัตรประชาชน (แยกไฟล์)", () => {
  const idcard = { docNo: "RC6909-0010", date: "2026-09-02", companyName: company.name, photoSrc: "card.jpg" };

  it("A4: รูปบัตร · เลขที่ · วันที่ · ข้อความจำกัดการใช้ · ลายน้ำระบบเดิม", () => {
    const html = renderIdCardHtml(idcard, { fontBaseUrl: "" });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("@page { size: A4 portrait;");
    expect(html).toContain("<title>สำเนาบัตรประชาชน RC6909-0010</title>");
    expect(html).toContain('<img src="card.jpg" alt="สำเนาบัตรประชาชน"/>');
    expect(html).toContain("วันที่ 2 กันยายน 2569");
    expect(html).toContain("<b>RC6909-0010</b>");
    expect(html).toContain("ใช้ประกอบใบรับซื้อของเก่าเลขที่ RC6909-0010 เท่านั้น");
    expect(html).toContain("ใช้สำหรับ โอเอ็นจี หลอมทอง<br/>การรับหลอมทอง ทำธุรกรรม เท่านั้น");
    expect(html).toContain('url("Sarabun-Regular.ttf")');
  });

  it("ไม่มีรูปบัตร / วันที่ผิด → ReceiptDataError (ไม่สร้างสำเนาบัตรเปล่า)", () => {
    expect(() => renderIdCardHtml({ ...idcard, photoSrc: " " })).toThrow(ReceiptDataError);
    expect(() => renderIdCardHtml({ ...idcard, photoSrc: " " })).toThrow(/ไม่มีรูปบัตร/);
    expect(() => renderIdCardHtml({ ...idcard, date: "2026-09-02T00:00:00Z" })).toThrow(ReceiptDataError);
  });

  it("รับรูปแบบ data: URI ได้", () => {
    const html = renderIdCardHtml({ ...idcard, photoSrc: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" });
    expect(html).toContain('src="data:image/jpeg;base64,/9j/4AAQSkZJRg=="');
  });

  it("escape ชื่อร้าน/เลขที่/ที่อยู่รูป", () => {
    const html = renderIdCardHtml({
      docNo: "<script>alert(1)</script>",
      date: "2026-09-02",
      companyName: "<b>ร้าน</b>",
      photoSrc: 'x" onerror="alert(2)',
    });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>ร้าน");
    expect(html).not.toContain('" onerror="');
    expect(html).toContain('src="x&quot; onerror=&quot;alert(2)"');
  });

  it("<IdCardCopy/> บนเว็บคือ markup ชุดเดียวกับใน PDF", () => {
    const component = renderToStaticMarkup(<IdCardCopy data={idcard} />);
    expect(renderIdCardHtml(idcard)).toContain(`<body>${component}</body>`);
  });
});

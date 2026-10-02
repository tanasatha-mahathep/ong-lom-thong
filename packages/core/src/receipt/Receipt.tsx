/** @jsxRuntime automatic @jsxImportSource react */
// pragma: ผู้ bundle ที่ใช้ tsconfig ของตัวเอง (tsup ของ apps/api) ก็ยังได้ JSX runtime อัตโนมัติ ไม่ใช่ React.createElement
import type { JSX } from "react";
import { formatMoney, formatWeight } from "../money";
import { groupLinesByMetal } from "../receiptLines";
import { bahtText, taxBranchLabel, thaiDate } from "../thai";
import { RECEIPT_CSS } from "./styles";
import type { ReceiptData } from "./types";
import { assertReceiptTotals } from "./validate";

/**
 * ใบรับซื้อของเก่า/ใบสำคัญจ่าย — A4 ตั้ง
 * พอร์ตจาก Django print/buy_receipt.html (จำลองจากใบจริง RC6909-0010) — ข้อความ ลำดับ และตำแหน่งตามใบจริง
 * ห้ามแก้ข้อความ/ลำดับโดยไม่เทียบใบจริงของร้าน · สำเนาบัตรแยกเป็น <IdCardCopy/> (สิทธิ์เข้าถึงต่างกัน)
 * markup ชุดเดียวใช้ทั้งหน้าเว็บ (/buy/$id, window.print) และ PDF เก็บถาวร (renderReceiptHtml)
 * ข้อมูลผิด (ยอดไม่ตรง · วันที่ · ตัวเลข · รหัสสาขาผิดรูป) = ReceiptDataError ทั้งบนเว็บและใน PDF — ครอบด้วย error boundary
 * หน้าเว็บ: ไม่มี taxBranchCode = ไม่พิมพ์ป้ายสาขา · PDF (renderReceiptHtml) ไม่มีรหัส = throw (fail-closed)
 */
export function Receipt({ data }: { data: ReceiptData }): JSX.Element {
  assertReceiptTotals(data);
  const { company, customer } = data;
  const branchLabel = taxBranchLabel(data.branch.taxBranchCode);
  const rows = groupLinesByMetal(data.lines);
  const isVoid = data.status === "void";
  const voidReason = data.voidReason?.trim();

  return (
    <div className={isVoid ? "ong-receipt void" : "ong-receipt"}>
      <style dangerouslySetInnerHTML={{ __html: RECEIPT_CSS }} />
      {isVoid && <div className="void-stamp">ยกเลิก</div>}
      {data.watermark && (
        <div className="ong-watermark" aria-hidden="true">
          <span>{data.watermark}</span>
        </div>
      )}

      <div className="company">
        <div className="name">{company.name}</div>
        {branchLabel ? `${company.address} (${branchLabel})` : company.address}
        <br />
        {`โทร.${company.tel} โทรสาร. ${company.fax?.trim() || "-"} \u00a0\u00a0 เลขประจำตัวผู้เสียภาษี ${company.taxId}`}
      </div>

      <div className="doctitle">ใบรับซื้อของเก่า/ใบสำคัญจ่าย</div>
      {isVoid && (
        <div className="void-note">
          {voidReason ? `ใบรับซื้อฉบับนี้ถูกยกเลิก · เหตุผล: ${voidReason}` : "ใบรับซื้อฉบับนี้ถูกยกเลิก"}
        </div>
      )}
      <div className="row">
        <div>{`วันที่ ${thaiDate(data.date)}`}</div>
        <div>
          {"เลขที่ "}
          <b>{data.docNo}</b>
        </div>
      </div>

      <div className="seller">
        {`ชื่อผู้ขาย : ${customer.nameTh.trim() || "ลูกค้าทั่วไป"}`}
        <br />
        {`ที่อยู่ : ${customer.address ?? ""}`}
        <br />
        {`เลขประจำตัวผู้เสียภาษี : ${customer.nationalId}`}
      </div>
      <hr />
      <table className="items">
        <thead>
          <tr>
            <th style={{ width: "34%" }}>รายการสินค้าที่ขาย</th>
            <th className="c" style={{ width: "16%" }}>
              ปริมาณ
            </th>
            <th className="c" style={{ width: "12%" }}>
              หน่วย
            </th>
            <th className="r" style={{ width: "19%" }}>
              ราคาต่อหน่วย
            </th>
            <th className="r" style={{ width: "19%" }}>
              ราคารวมสินค้า
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="c">{row.label}</td>
              <td className="c">{formatWeight(row.weightG)}</td>
              <td className="c">กรัม</td>
              <td className="r">{formatMoney(row.unitPrice)}</td>
              <td className="r">{formatMoney(row.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr />
      <div className="note">{`รายละเอียด (ถ้ามี): ${data.detail ?? ""}`}</div>

      <div className="words">
        <span className="lab">ตัวอักษร</span> <b>{bahtText(data.totalAmount)}</b>
      </div>

      <div className="bottom">
        <div className="cert">
          ข้าพเจ้า(ผู้ขาย)ขอรับรองว่าสิ่งของที่นำมาขายนั้นเป็นกรรมสิทธิ์โดยชอบ
          <br />
          ของข้าพเจ้าอย่างแท้จริง ปราศจากภาระผูกพันและริดรอนสิทธิ์ใดๆ
          <br />
          และเป็นของบริสุทธิ์ไม่ทุจริต หากไม่ได้เป็นไปตามที่กล่าวมาข้างต้น
          <br />
          ข้าพเจ้าขอรับผิดชอบทั้งสิ้น โดยไม่มีข้อโต้แย้งทุกกรณี
        </div>
        <div className="pay">
          <div className="title">วิธีการชำระเงิน</div>
          <table className="paytb">
            <thead>
              <tr>
                <th>ประเภท</th>
                <th>ชื่อธนาคาร</th>
                <th>จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p, i) => (
                <tr key={i}>
                  <td>{p.label}</td>
                  <td>{p.bank?.trim() || "-"}</td>
                  <td className="r">{formatMoney(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="signrow">
        <div>
          ผู้ขาย/รับรองสำเนาบัตรประชาชน/ผู้รับเงิน
          <div className="signline" />
        </div>
        <div>
          {`ผู้ซื้อ ในนาม ${company.name}`}
          <div className="signline" />
        </div>
      </div>
    </div>
  );
}

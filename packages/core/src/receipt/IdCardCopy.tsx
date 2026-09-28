/** @jsxRuntime automatic @jsxImportSource react */
// pragma: ผู้ bundle ที่ใช้ tsconfig ของตัวเอง (tsup ของ apps/api) ก็ยังได้ JSX runtime อัตโนมัติ ไม่ใช่ React.createElement
import type { JSX } from "react";
import { thaiDate } from "../thai";
import { IDCARD_CSS } from "./styles";
import type { IdCardCopyData } from "./types";

/**
 * สำเนาบัตรประชาชนประกอบใบรับซื้อ — A4 แยกไฟล์ (สเปก §9.1 · สิทธิ์เข้าถึงแคบกว่าใบรับซื้อ)
 * ลายน้ำทับรูปใช้ข้อความเดียวกับระบบเดิม (Django print/_idcard.html)
 */
export function IdCardCopy({ data }: { data: IdCardCopyData }): JSX.Element {
  // สำเนาบัตรสร้างเฉพาะบิลที่มีรูปบัตร (สเปก §9.2) — ไม่มีรูป = ไม่ควรมีไฟล์นี้
  if (data.photoSrc.trim() === "") throw new Error(`สำเนาบัตร ${data.docNo}: ไม่มีรูปบัตร`);
  return (
    <div className="ong-idcard">
      <style dangerouslySetInnerHTML={{ __html: IDCARD_CSS }} />
      <div className="company">{data.companyName}</div>
      <div className="doctitle">สำเนาบัตรประชาชน</div>
      <div className="row">
        <div>{`วันที่ ${thaiDate(data.date)}`}</div>
        <div>
          {"เลขที่ "}
          <b>{data.docNo}</b>
        </div>
      </div>

      <div className="photo">
        <img src={data.photoSrc} alt="สำเนาบัตรประชาชน" />
        <div className="watermark">
          {`ใช้สำหรับ ${data.companyName}`}
          <br />
          การรับหลอมทอง ทำธุรกรรม เท่านั้น
        </div>
      </div>

      <div className="purpose">{`ใช้ประกอบใบรับซื้อของเก่าเลขที่ ${data.docNo} เท่านั้น`}</div>
    </div>
  );
}

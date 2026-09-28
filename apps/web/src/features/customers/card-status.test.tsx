import type { CardStatus } from "@ong/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CardStatusBadge, CardStatusNotice } from "./card-status";

describe("CardStatusBadge", () => {
  it.each([
    ["ok", "บัตรใช้ได้"],
    ["expired", "บัตรหมดอายุ"],
    // ไม่ใช่ "ไม่มีวันหมดอายุ" — อ่านแล้วเหมือนบัตรตลอดชีพ
    ["missing", "ไม่ได้กรอกวันหมดอายุ"],
    ["invalid", "วันที่ผิดรูป"],
  ] satisfies [CardStatus, string][])("%s → %s", (status, label) => {
    render(<CardStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe("CardStatusNotice", () => {
  it("บัตรใช้ได้ → วันหมดอายุเป็นภาษาไทย ไม่มีกล่องเตือน", () => {
    render(<CardStatusNotice status="ok" expireText="31/12/2574" expireDate="2031-12-31" />);
    expect(screen.getByText("ใช้ได้ถึง 31 ธันวาคม 2574")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("บัตรตลอดชีพ (ไม่มีวันที่) → บัตรตลอดชีพ", () => {
    render(<CardStatusNotice status="ok" expireText="ตลอดชีพ" expireDate={null} />);
    expect(screen.getByText("บัตรตลอดชีพ")).toBeInTheDocument();
  });

  it.each([
    ["expired", "01/01/2500", "บัตรประชาชนหมดอายุแล้ว"],
    ["invalid", "31 ธันวา 2574", "รูปแบบวันที่บัตรหมดอายุไม่ถูกต้อง"],
    ["missing", null, "ยังไม่ได้กรอกวันที่บัตรหมดอายุ"],
  ] satisfies [CardStatus, string | null, string][])(
    "%s → เหตุผล + ข้อความที่บันทึกไว้ + ซื้อเข้าไม่ได้ + ปุ่มแก้ไข",
    (status, text, reason) => {
      render(
        <CardStatusNotice
          status={status}
          expireText={text}
          expireDate={null}
          action={<button type="button">แก้ไขข้อมูลบัตร</button>}
        />,
      );
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(reason);
      expect(alert).toHaveTextContent("ซื้อเข้าไม่ได้จนกว่าจะแก้ไขข้อมูลบัตร");
      if (text) expect(alert).toHaveTextContent(`“${text}”`);
      expect(screen.getByRole("button", { name: "แก้ไขข้อมูลบัตร" })).toBeInTheDocument();
    },
  );
});

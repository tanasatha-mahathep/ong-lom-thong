import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Branch, Role } from "@/lib/queries";
import { BRANCH_2, BRANCH_HQ, GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";

const BRANCH_3: Branch = { id: "b-00002", code: "00002", name: "สาขา 3" };
const WARNING = "ราคาห่างจากครั้งก่อน 4.4% (67,850 → 70,850) — ตรวจสอบก่อนบันทึก";

type Row = {
  branch: Branch;
  bar_sell: string | null;
  bar_buy: string | null;
  jewelry_buy: string | null;
  source: "branch" | "central" | null;
};

const central = (branch: Branch): Row => ({
  branch,
  bar_sell: "67850.00",
  bar_buy: "67650.00",
  jewelry_buy: "64268",
  source: "central",
});
/** ค่าที่สูตรใดใน browser ก็ให้ไม่ได้ — จอแสดงค่านี้ได้ก็ต่อเมื่อมาจากเซิร์ฟเวอร์ */
const own = (branch: Branch, barSell = "68000.50"): Row => ({
  branch,
  bar_sell: barSell,
  bar_buy: "67777.77",
  jewelry_buy: "64411",
  source: "branch",
});
const unset = (branch: Branch): Row => ({ branch, bar_sell: null, bar_buy: null, jewelry_buy: null, source: null });

const confirmedTypo = (body: unknown) =>
  typeof body === "object" && body !== null && "confirm_typo" in body && body.confirm_typo === true;

/**
 * API ปลอมที่จำสถานะ: PUT/DELETE เปลี่ยนแถวของสาขานั้น · GET /today คืนราคาที่สาขาปัจจุบัน (HQ) ใช้จริง
 */
function stateful(initial: Row[]) {
  let rows = initial;
  const replace = (next: Row) => {
    rows = rows.map((row) => (row.branch.id === next.branch.id ? next : row));
    return json(next);
  };
  const hq = () => rows.find((row) => row.branch.id === BRANCH_HQ.id);
  return {
    "GET /api/gold-price/today/branches": () => json(rows),
    "GET /api/gold-price/today": () => {
      const row = hq();
      return row?.bar_sell ? json({ ...GOLD_PRICE, ...row, branch: undefined }) : json({ error: "none" }, 404);
    },
    [`PUT /api/gold-price/today/branches/${BRANCH_HQ.id}`]: () => replace(own(BRANCH_HQ, "70850.00")),
    [`PUT /api/gold-price/today/branches/${BRANCH_2.id}`]: () => replace(own(BRANCH_2, "70850.00")),
    [`DELETE /api/gold-price/today/branches/${BRANCH_2.id}`]: () => replace(central(BRANCH_2)),
  };
}

async function openAs(role: Role, routes: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi({
    "GET /api/me": () => json(makeMe(role, [BRANCH_HQ, BRANCH_2])),
    "POST /api/gold-price/quote": () => json({ bar_sell: "70850.00", bar_buy: "70650.00", jewelry_buy: "67118" }),
    ...stateful([central(BRANCH_HQ), own(BRANCH_2), unset(BRANCH_3)]),
    ...routes,
  });
  renderApp("/settings/gold-price");
  await screen.findByRole("heading", { level: 1, name: "ตั้งราคาทองวันนี้" });
  return { api, user: userEvent.setup() };
}

const table = () => screen.findByRole("table", { name: "ราคาทองวันนี้ของแต่ละสาขา" });
const rowOf = async (label: string) => within(await table()).getByRole("row", { name: new RegExp(label) });
const putBodies = (api: Awaited<ReturnType<typeof openAs>>["api"], branch: Branch) =>
  api.callsTo("PUT", `/api/gold-price/today/branches/${branch.id}`).map((call) => call.body);

describe("ราคาเฉพาะสาขา — ตาราง", () => {
  it("แต่ละสาขา: ราคาที่ใช้จริงแบบกระดาน · ที่มาเป็นป้าย · ยังไม่ตั้ง = –", async () => {
    await openAs("manager");
    const region = screen.getByRole("region", { name: "ราคาเฉพาะสาขา" });
    expect(region).toHaveTextContent("บันทึกราคากลางใหม่ไม่เปลี่ยนราคาของสาขาเหล่านี้");

    const hq = await rowOf("00000 สำนักงานใหญ่");
    expect(hq).toHaveTextContent("67,850");
    expect(hq).toHaveTextContent("64,268");
    expect(within(hq).getByText("ราคากลาง")).toBeInTheDocument();
    expect(within(hq).getByText("สาขาที่กำลังทำงาน")).toBeInTheDocument();
    expect(within(hq).queryByRole("button", { name: /ใช้ราคากลาง/ })).not.toBeInTheDocument();

    const second = await rowOf("00001 สาขา 2");
    expect(within(second).getByRole("cell", { name: "68,000.50" })).toHaveClass("tabular-nums");
    expect(within(second).getByRole("cell", { name: "67,777.77" })).toBeInTheDocument();
    expect(within(second).getByRole("cell", { name: "64,411" })).toBeInTheDocument();
    expect(within(second).getByText("สาขา", { selector: "[data-slot=badge]" })).toBeInTheDocument();
    expect(within(second).getByRole("button", { name: "ใช้ราคากลาง สาขา 2" })).toBeInTheDocument();

    const third = await rowOf("00002 สาขา 3");
    expect(within(third).getByText("ยังไม่ตั้ง")).toBeInTheDocument();
    expect(within(third).getAllByRole("cell", { name: "–" })).toHaveLength(3);
    expect(within(third).getByRole("button", { name: "ตั้งราคาสาขา สาขา 3" })).toBeInTheDocument();
  });

  it.each<Role>(["staff", "accounting"])("%s ไม่เห็นราคาเฉพาะสาขา และไม่ถาม API", async (role) => {
    const { api } = await openAs(role);

    expect(screen.queryByRole("region", { name: "ราคาเฉพาะสาขา" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ตั้งราคาสาขา/ })).not.toBeInTheDocument();
    expect(api.callsTo("GET", "/api/gold-price/today/branches")).toEqual([]);
  });

  it.each<Role>(["manager", "admin"])("%s จัดการราคาเฉพาะสาขาได้", async (role) => {
    await openAs(role);

    expect(await rowOf("00001 สาขา 2")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^ตั้งราคาสาขา / })).toHaveLength(3);
  });
});

describe("ราคาเฉพาะสาขา — ตั้งราคา", () => {
  it("Dialog: quote พร้อม branch_id → Enter บันทึก → ตารางอ่านใหม่ · โฟกัสกลับปุ่มเดิม", async () => {
    const { api, user } = await openAs("manager");
    const trigger = within(await rowOf("00000 สำนักงานใหญ่")).getByRole("button", {
      name: "ตั้งราคาสาขา สำนักงานใหญ่ (สาขา 1)",
    });
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "ตั้งราคาเฉพาะสาขา — สำนักงานใหญ่ (สาขา 1)" });
    const input = within(dialog).getByLabelText("ราคาทองแท่งขายออกของสาขานี้ (บาท)");
    await waitFor(() => expect(input).toHaveFocus());
    expect(dialog).toHaveTextContent("ราคาที่ใช้อยู่ตอนนี้: ทองแท่งขายออก 67,850 บาท (ราคากลาง)");

    await user.keyboard("70850.");
    const preview = within(within(dialog).getByRole("region", { name: "ราคาที่จะบันทึก" })).getByRole("status");
    await waitFor(() => expect(preview).toHaveTextContent("70,650"));
    expect(api.callsTo("POST", "/api/gold-price/quote").map((call) => call.body)).toEqual([
      { bar_sell: "70850", branch_id: BRANCH_HQ.id },
    ]);

    await user.keyboard("{Enter}");
    expect(await screen.findByText("ตั้งราคาเฉพาะสาขาของสำนักงานใหญ่ (สาขา 1)แล้ว")).toBeInTheDocument();
    expect(putBodies(api, BRANCH_HQ)).toEqual([{ bar_sell: "70850" }]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const hq = await rowOf("00000 สำนักงานใหญ่");
    await waitFor(() => expect(hq).toHaveTextContent("70,850"));
    expect(within(hq).getByText("สาขา", { selector: "[data-slot=badge]" })).toBeInTheDocument();
    await waitFor(() => expect(within(hq).getByRole("button", { name: /^ตั้งราคาสาขา/ })).toHaveFocus());
  });

  it("409 (field confirm_typo) → ยืนยันแบบเดียวกับราคากลาง → ส่งซ้ำพร้อม confirm_typo", async () => {
    const { api, user } = await openAs("manager", {
      [`PUT /api/gold-price/today/branches/${BRANCH_2.id}`]: ({ body }) =>
        confirmedTypo(body)
          ? json(own(BRANCH_2, "70850.00"))
          : json({ error: WARNING, field: "confirm_typo", warning: WARNING }, 409),
    });
    await user.click(within(await rowOf("00001 สาขา 2")).getByRole("button", { name: "ตั้งราคาสาขา สาขา 2" }));
    await screen.findByRole("dialog");
    await user.keyboard("70850{Enter}");

    const confirm = await screen.findByRole("alertdialog", { name: "ยืนยันราคาทองวันนี้ของสาขา 2" });
    expect(confirm).toHaveAccessibleDescription(WARNING);
    await waitFor(() => expect(within(confirm).getByRole("button", { name: "กลับไปแก้ไข" })).toHaveFocus());
    await user.tab();
    expect(within(confirm).getByRole("button", { name: "ยืนยันบันทึกราคานี้" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(await screen.findByText("ตั้งราคาเฉพาะสาขาของสาขา 2แล้ว")).toBeInTheDocument();
    expect(putBodies(api, BRANCH_2)).toEqual([{ bar_sell: "70850" }, { bar_sell: "70850", confirm_typo: true }]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("Esc ที่ด่านกันพิมพ์ผิด → กลับช่องราคาใน Dialog พร้อมตัวเลขเดิม ไม่บันทึก", async () => {
    const { api, user } = await openAs("manager", {
      [`PUT /api/gold-price/today/branches/${BRANCH_2.id}`]: () =>
        json({ error: WARNING, field: "confirm_typo", warning: WARNING }, 409),
    });
    await user.click(within(await rowOf("00001 สาขา 2")).getByRole("button", { name: "ตั้งราคาสาขา สาขา 2" }));
    const dialog = await screen.findByRole("dialog");
    await user.keyboard("70850{Enter}");
    await screen.findByRole("alertdialog");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    const input = within(dialog).getByLabelText("ราคาทองแท่งขายออกของสาขานี้ (บาท)");
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue("70850");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(putBodies(api, BRANCH_2)).toEqual([{ bar_sell: "70850" }]);
  });

  it("404 (สาขาถูกปิด/ถอนสิทธิ์) → ข้อความไทยใน Dialog และโหลดรายการสาขาใหม่", async () => {
    const { api, user } = await openAs("manager", {
      [`PUT /api/gold-price/today/branches/${BRANCH_2.id}`]: () => json({ error: "not found" }, 404),
    });
    await user.click(within(await rowOf("00001 สาขา 2")).getByRole("button", { name: "ตั้งราคาสาขา สาขา 2" }));
    const dialog = await screen.findByRole("dialog");
    const listCalls = api.callsTo("GET", "/api/gold-price/today/branches").length;
    await user.keyboard("70850{Enter}");

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "ไม่พบสาขานี้ หรือบัญชีนี้ไม่มีสิทธิ์ในสาขานี้แล้ว",
    );
    expect(screen.queryByText(/not found/)).not.toBeInTheDocument();
    await waitFor(() => expect(api.callsTo("GET", "/api/gold-price/today/branches").length).toBeGreaterThan(listCalls));
  });

  it("ช่องว่าง + Enter → เตือนใต้ช่อง ไม่ส่ง API · ยกเลิกปิด Dialog โดยไม่บันทึก", async () => {
    const { api, user } = await openAs("manager");
    await user.click(within(await rowOf("00001 สาขา 2")).getByRole("button", { name: "ตั้งราคาสาขา สาขา 2" }));
    const dialog = await screen.findByRole("dialog");
    await user.keyboard("{Enter}");

    expect(await within(dialog).findByText("กรอกราคาทองแท่งขายออก")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "ยกเลิก" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(putBodies(api, BRANCH_2)).toEqual([]);
  });
});

describe("ราคาเฉพาะสาขา — ใช้ราคากลาง", () => {
  it("AlertDialog ยืนยัน (โฟกัสเริ่มที่ยกเลิก) → DELETE → แถวกลับเป็นราคากลาง · โฟกัสไปปุ่มตั้งราคาของแถว", async () => {
    const { api, user } = await openAs("manager");
    await user.click(within(await rowOf("00001 สาขา 2")).getByRole("button", { name: "ใช้ราคากลาง สาขา 2" }));

    const confirm = await screen.findByRole("alertdialog", { name: "ให้สาขา 2กลับไปใช้ราคากลาง?" });
    await waitFor(() => expect(within(confirm).getByRole("button", { name: "ยกเลิก" })).toHaveFocus());
    await user.tab();
    expect(within(confirm).getByRole("button", { name: "ใช้ราคากลาง" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(await screen.findByText("สาขา 2 กลับไปใช้ราคากลางแล้ว")).toBeInTheDocument();
    expect(api.callsTo("DELETE", `/api/gold-price/today/branches/${BRANCH_2.id}`)).toHaveLength(1);
    const second = await rowOf("00001 สาขา 2");
    await waitFor(() => expect(within(second).getByText("ราคากลาง")).toBeInTheDocument());
    expect(second).toHaveTextContent("67,850");
    expect(within(second).queryByRole("button", { name: /ใช้ราคากลาง/ })).not.toBeInTheDocument();
    await waitFor(() => expect(within(second).getByRole("button", { name: "ตั้งราคาสาขา สาขา 2" })).toHaveFocus());
  });

  it("กดยกเลิก → ไม่ลบ · โฟกัสกลับปุ่มใช้ราคากลาง", async () => {
    const { api, user } = await openAs("manager");
    const button = within(await rowOf("00001 สาขา 2")).getByRole("button", { name: "ใช้ราคากลาง สาขา 2" });
    await user.click(button);
    await screen.findByRole("alertdialog");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => expect(button).toHaveFocus());
    expect(api.callsTo("DELETE", `/api/gold-price/today/branches/${BRANCH_2.id}`)).toEqual([]);
  });
});

describe("ราคากลางกับราคาเฉพาะสาขา", () => {
  it("บันทึกราคากลางแล้วตารางสาขาอ่านใหม่ด้วย — สาขาที่มีราคาเองยังเป็นราคาของสาขา", async () => {
    let rows: Row[] = [central(BRANCH_HQ), own(BRANCH_2)];
    const { user } = await openAs("manager", {
      "GET /api/gold-price/today/branches": () => json(rows),
      "PUT /api/gold-price/today": () => {
        rows = [
          { ...central(BRANCH_HQ), bar_sell: "70850.00", bar_buy: "70650.00", jewelry_buy: "67118" },
          own(BRANCH_2),
        ];
        return json({ ...GOLD_PRICE, bar_sell: "70850.00", bar_buy: "70650.00", jewelry_buy: "67118" });
      },
    });
    await rowOf("00000 สำนักงานใหญ่");
    await user.click(screen.getByLabelText("ราคาทองแท่งขายออก (บาท)"));
    await user.keyboard("70850{Enter}");

    expect(await screen.findByText("บันทึกราคาทองวันนี้แล้ว")).toBeInTheDocument();
    await waitFor(async () => expect(await rowOf("00000 สำนักงานใหญ่")).toHaveTextContent("70,850"));
    const second = await rowOf("00001 สาขา 2");
    expect(second).toHaveTextContent("68,000.50");
    expect(within(second).getByText("สาขา", { selector: "[data-slot=badge]" })).toBeInTheDocument();
  });
});

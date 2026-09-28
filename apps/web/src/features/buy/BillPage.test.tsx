import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/queries";
import { GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";
import { makeBill } from "@/test/bill-fixture";
import type { Bill } from "./bill-api";
import { t } from "./i18n";

const BILL = makeBill();
const PATH = `/api/buy/${BILL.id}`;

function setup(bill: Bill | null, { role = "staff", search = "" }: { role?: Role; search?: string } = {}) {
  const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
  const api = fakeApi({
    "GET /api/me": () => json(makeMe(role)),
    "GET /api/gold-price/today": () => json(GOLD_PRICE),
    [`GET ${PATH}`]: () => (bill ? json(bill) : json({ error: "not found" }, 404)),
  });
  const user = userEvent.setup();
  const router = renderApp(`/buy/${BILL.id}${search}`);
  return { api, print, router, user };
}

const pdfLink = () => screen.queryByRole("link", { name: new RegExp(t("bill.openPdf")) });

describe("/buy/$id", () => {
  it("shows the receipt with the masked ID and prints once after a save", async () => {
    const { print, router } = setup(BILL, { search: "?print=true" });
    expect(await screen.findByText(t("bill.title", { docNo: BILL.doc_no }))).toBeInTheDocument();
    const receipt = screen.getByRole("region", { name: t("bill.receiptLabel") });
    expect(within(receipt).getByText("ใบรับซื้อของเก่า/ใบสำคัญจ่าย")).toBeInTheDocument();
    expect(within(receipt).getByText(/1 XXXX XXXXX 01 0/)).toBeInTheDocument();
    expect(within(receipt).getByText("สองหมื่นสามสิบบาทถ้วน")).toBeInTheDocument();
    // สำเนาสำหรับพิมพ์อยู่นอก #root
    expect(document.body.querySelector(":scope > .print-only .ong-receipt")).not.toBeNull();

    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(screen.getByRole("link", { name: new RegExp(t("bill.newBill")) })).toHaveFocus();
  });

  it("skips auto-print when the receipt data does not add up (nit)", async () => {
    // total_amount ไม่ตรงกับผลรวมรายการ — <Receipt/> throw · error boundary จับไว้แทนพัง แต่ไม่ควรพิมพ์กระดาษเปล่า/ error
    const { print } = setup(makeBill({ total_amount: "999999.00" }), { search: "?print=true" });
    expect(await screen.findByText(/แสดงใบรับซื้อไม่ได้/)).toBeInTheDocument();
    expect(print).not.toHaveBeenCalled();
  });

  it("offers the archived PDF only when it is ready", async () => {
    setup(makeBill({ created_at: new Date().toISOString() }));
    expect(await screen.findByText(t("bill.pdf.pending"))).toBeInTheDocument();
    expect(pdfLink()).not.toBeInTheDocument();
  });

  it("links to the ready PDF for opening and downloading", async () => {
    setup(makeBill({ pdf_status: "ready" }));
    expect(await screen.findByText(t("bill.pdf.ready"))).toBeInTheDocument();
    expect(pdfLink()).toHaveAttribute("href", `${PATH}/pdf`);
    expect(pdfLink()).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: t("bill.downloadPdf") })).toHaveAttribute("download", "RC6909-0001.pdf");
  });

  it("stops asking after two minutes and lets staff check again", async () => {
    const { api, user } = setup(makeBill({ created_at: "2026-09-01T00:00:00.000Z" }));
    const check = await screen.findByRole("button", { name: t("bill.pdf.check") });
    expect(screen.getByText(t("bill.pdf.stalled"))).toBeInTheDocument();
    const before = api.callsTo("GET", PATH).length;
    await user.click(check);
    await waitFor(() => expect(api.callsTo("GET", PATH).length).toBe(before + 1));
  });

  it("lets a manager retry a failed PDF and explains when the PDF service is not there yet", async () => {
    const { user } = setup(makeBill({ pdf_status: "failed" }), { role: "manager" });
    expect(await screen.findByText(t("bill.pdf.failed"))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t("bill.retryPdf") }));
    expect(await screen.findByText(t("bill.retryUnavailable"))).toBeInTheDocument();
  });

  it("hides retry from staff and shows the ID-card copy to accounting only", async () => {
    setup(makeBill({ pdf_status: "failed", idcard_status: "ready" }));
    await screen.findByText(t("bill.pdf.failed"));
    expect(screen.queryByRole("button", { name: t("bill.retryPdf") })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: new RegExp(t("bill.idCard")) })).not.toBeInTheDocument();
  });

  it("gives accounting the audited ID-card link", async () => {
    setup(makeBill({ idcard_status: "ready" }), { role: "accounting" });
    const link = await screen.findByRole("link", { name: new RegExp(t("bill.idCard").replace(/[()]/g, "\\$&")) });
    expect(link).toHaveAttribute("href", `${PATH}/idcard`);
    expect(link).toHaveAccessibleDescription(t("bill.idCardNote"));
    expect(screen.queryByRole("link", { name: new RegExp(t("bill.newBill")) })).not.toBeInTheDocument();
  });

  it("asks a manager for a reason before voiding", async () => {
    const { user, api } = setup(BILL, { role: "manager" });
    await user.click(await screen.findByRole("button", { name: t("bill.void.button") }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: t("bill.void.confirm") }));
    expect(within(dialog).getByText(t("bill.void.reasonRequired"))).toBeInTheDocument();
    expect(api.callsTo("POST", `${PATH}/void`)).toHaveLength(0);

    await user.type(within(dialog).getByLabelText(t("bill.void.reason")), "คีย์ผิดลูกค้า");
    await user.click(within(dialog).getByRole("button", { name: t("bill.void.confirm") }));
    await waitFor(() => expect(api.callsTo("POST", `${PATH}/void`)).toHaveLength(1));
    expect(api.callsTo("POST", `${PATH}/void`)[0]?.body).toEqual({ reason: "คีย์ผิดลูกค้า" });
    expect(await within(dialog).findByText(t("bill.void.unavailable"))).toBeInTheDocument();
  });

  it("marks a void bill and its reason", async () => {
    setup(makeBill({ status: "void", void_reason: "คีย์ผิดลูกค้า", voided_at: "2026-09-29T08:00:00.000Z" }), {
      role: "manager",
    });
    expect(await screen.findByText(t("bill.voidReason", { reason: "คีย์ผิดลูกค้า" }))).toBeInTheDocument();
    expect(screen.getAllByText(t("bill.voidBadge")).some((el) => el.dataset.slot === "badge")).toBe(true);
    // ใบบนจอมีตรายกเลิกและเหตุผล (ตัวเดียวกับ PDF ฉบับยกเลิก)
    const receipt = screen.getByRole("region", { name: t("bill.receiptLabel") });
    expect(within(receipt).getByText(/ใบรับซื้อฉบับนี้ถูกยกเลิก · เหตุผล: คีย์ผิดลูกค้า/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("bill.void.button") })).not.toBeInTheDocument();
  });

  it("says so when the bill is missing or not readable", async () => {
    setup(null);
    expect(await screen.findByText(t("bill.notFound"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: t("bill.toBills") })).toHaveAttribute("href", "/bills");
  });
});

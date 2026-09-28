import { createColumnHelper } from "@tanstack/react-table";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { formatMoney } from "@/lib/format";
import { DataTable, type DataTableProps } from "./data-table";

interface Bill {
  id: string;
  doc_no: string;
  total_amount: string;
}

const column = createColumnHelper<Bill>();
const columns = [
  column.accessor("doc_no", { header: "เลขที่" }),
  column.accessor("total_amount", {
    header: "ยอดรวม",
    cell: (info) => formatMoney(info.getValue()),
    meta: { numeric: true },
  }),
];
const bills: Bill[] = [
  { id: "1", doc_no: "RC6909-0001", total_amount: "20030.00" },
  { id: "2", doc_no: "RC6909-0002", total_amount: "99999999999999.99" },
];

function renderTable(props: Partial<DataTableProps<Bill>> = {}) {
  const onPageChange = vi.fn();
  render(
    <DataTable
      caption="บิล"
      columns={columns}
      data={bills}
      getRowId={(bill) => bill.id}
      page={1}
      hasMore={false}
      onPageChange={onPageChange}
      {...props}
    />,
  );
  return { onPageChange };
}

describe("DataTable", () => {
  it("เป็น <table> จริง มีหัวคอลัมน์และค่าเงินชิดขวา", () => {
    renderTable();
    const table = screen.getByRole("table", { name: "บิล" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["เลขที่", "ยอดรวม"]);
    const total = within(table).getByRole("cell", { name: "99,999,999,999,999.99" });
    expect(total).toHaveClass("text-right", "tabular-nums");
  });

  it("แถวกดได้ด้วยคีย์บอร์ด: Tab เข้าแถว · ↓ แถวถัดไป · Enter เปิด", async () => {
    const onRowActivate = vi.fn();
    renderTable({ onRowActivate });
    const user = userEvent.setup();
    const [first, second] = screen.getAllByRole("row").slice(1);

    await user.tab();
    expect(first).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(second).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onRowActivate).toHaveBeenCalledWith(bills[1]);
  });

  it("ไม่ส่ง onRowActivate = แถวไม่รับโฟกัส", async () => {
    renderTable();
    await userEvent.setup().tab();
    expect(document.body).toHaveFocus();
  });

  it("แบ่งหน้าจากเซิร์ฟเวอร์ด้วย page + has_more (ไม่มียอดรวมจำนวนแถว)", async () => {
    const { onPageChange } = renderTable({ page: 2, hasMore: true });
    const user = userEvent.setup();
    const pager = screen.getByRole("navigation", { name: "เปลี่ยนหน้า" });
    expect(pager).toHaveTextContent("หน้า 2");

    await user.click(within(pager).getByRole("button", { name: "ก่อนหน้า" }));
    await user.click(within(pager).getByRole("button", { name: "ถัดไป" }));
    expect(onPageChange.mock.calls).toEqual([[1], [3]]);
  });

  it("หน้าสุดท้ายกดถัดไปไม่ได้ · หน้าเดียวไม่แสดงตัวเปลี่ยนหน้า", () => {
    renderTable({ page: 3, hasMore: false });
    expect(screen.getByRole("button", { name: "ถัดไป" })).toBeDisabled();
  });

  it("ไม่มีข้อมูล / กำลังโหลด", () => {
    const { unmount } = render(
      <DataTable caption="บิล" columns={columns} data={[]} page={1} hasMore={false} onPageChange={vi.fn()} />,
    );
    expect(screen.getByRole("cell", { name: "ไม่พบข้อมูล" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "เปลี่ยนหน้า" })).not.toBeInTheDocument();
    unmount();

    renderTable({ data: [], isLoading: true });
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
  });
});

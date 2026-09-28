import { type RowData, type TableOptions, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface DataTableProps<TData> {
  /** column defs ของ TanStack Table — ตัวเลขเงินให้ใส่ `meta: { numeric: true }` (ชิดขวา + tabular-nums) */
  columns: TableOptions<TData>["columns"];
  data: TData[];
  /** ชื่อตารางสำหรับ screen reader (caption ซ่อนไว้) */
  caption: string;
  /** แบ่งหน้าฝั่งเซิร์ฟเวอร์: หน้าปัจจุบัน (เริ่ม 1) + `has_more` จาก API — ไม่มียอดรวมจำนวนแถว */
  page: number;
  hasMore: boolean;
  onPageChange: (page: number) => void;
  /** โหลดครั้งแรก (ยังไม่มีข้อมูล) */
  isLoading?: boolean;
  /** กด Enter/Space หรือคลิกที่แถว เช่น เปิดหน้ารายละเอียด — ไม่ส่ง = แถวกดไม่ได้ */
  onRowActivate?: (row: TData) => void;
  getRowId?: TableOptions<TData>["getRowId"];
  emptyMessage?: string;
}

declare module "@tanstack/react-table" {
  // ชื่อ type parameter ต้องตรงกับ declaration เดิมของ TanStack Table (merge interface) แม้ไม่ได้ใช้
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** คอลัมน์ตัวเลข — ชิดขวาและตัวเลขความกว้างเท่ากัน */
    numeric?: boolean;
  }
}

const SKELETON_ROWS = 5;

/** ลูกศรขึ้น/ลงย้ายโฟกัสระหว่างแถวที่กดได้ */
function moveRowFocus(event: KeyboardEvent<HTMLTableRowElement>) {
  const target =
    event.key === "ArrowDown"
      ? event.currentTarget.nextElementSibling
      : event.key === "ArrowUp"
        ? event.currentTarget.previousElementSibling
        : null;
  if (target instanceof HTMLElement && target.tabIndex === 0) {
    event.preventDefault();
    target.focus();
  }
}

/** ตารางรายการทั่วไป (TanStack Table) — หน้ารายการทุกหน้าใช้ตัวนี้ · ไม่มีลากสลับแถว */
export function DataTable<TData>({
  columns,
  data,
  caption,
  page,
  hasMore,
  onPageChange,
  isLoading = false,
  onRowActivate,
  getRowId,
  emptyMessage = "ไม่พบข้อมูล",
}: DataTableProps<TData>) {
  // แอปไม่ได้ใช้ React Compiler — คำเตือนเรื่อง memo ของ TanStack Table v8 ไม่เกี่ยว
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });
  const columnCount = table.getVisibleLeafColumns().length;
  const rows = table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table aria-busy={isLoading}>
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader className="bg-muted">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    className={cn("px-3", header.column.columnDef.meta?.numeric && "text-right")}
                  >
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <TableRow key={i} className="hover:bg-transparent">
                  <TableCell colSpan={columnCount} className="px-3">
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columnCount} className="h-24 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  {...(onRowActivate && {
                    tabIndex: 0,
                    className: "focus-inset cursor-pointer",
                    onClick: () => onRowActivate(row.original),
                    onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onRowActivate(row.original);
                      } else {
                        moveRowFocus(event);
                      }
                    },
                  })}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn("px-3", cell.column.columnDef.meta?.numeric && "text-right tabular-nums")}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {(page > 1 || hasMore) && (
        <nav aria-label="เปลี่ยนหน้า" className="flex items-center justify-end gap-2">
          <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            หน้า {page}
          </span>
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft aria-hidden="true" />
            ก่อนหน้า
          </Button>
          <Button variant="outline" size="sm" disabled={!hasMore} onClick={() => onPageChange(page + 1)}>
            ถัดไป
            <ChevronRight aria-hidden="true" />
          </Button>
        </nav>
      )}
    </div>
  );
}

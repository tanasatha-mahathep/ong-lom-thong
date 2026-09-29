import { type RowData, type TableOptions, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
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
  /**
   * คลิกที่ไหนก็ได้ในแถว = ทางลัดของเมาส์ (เช่น เปิดหน้ารายละเอียด) · ไม่ใช่ทางหลัก:
   * คอลัมน์หลัก (เลขที่บิล / ชื่อลูกค้า) **ต้องเป็น `<Link>` จริง** — คีย์บอร์ดและ screen reader ใช้ลิงก์นั้น
   */
  onRowClick?: (row: TData) => void;
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

/** คลิกโดนลิงก์/ปุ่ม/ช่องกรอกในแถว หรือกำลังลากเลือกข้อความ — ปล่อยให้ element นั้นทำงานเอง */
function isOwnClick(event: MouseEvent<HTMLTableRowElement>) {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("a[href], button, input, select, textarea, label, [role='button'], [role='link']")) return true;
  return !!window.getSelection()?.toString();
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
  onRowClick,
  getRowId,
  emptyMessage,
}: DataTableProps<TData>) {
  const { t } = useTranslation("shell");
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
    <div className="flex min-w-0 flex-col gap-3">
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
                  {emptyMessage ?? t("table.empty")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  {...(onRowClick && {
                    className: "cursor-pointer",
                    onClick: (event: MouseEvent<HTMLTableRowElement>) => {
                      if (!isOwnClick(event)) onRowClick(row.original);
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
        <nav aria-label={t("table.pager")} className="flex items-center justify-end gap-2">
          <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {t("table.page", { page })}
          </span>
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft aria-hidden="true" />
            {t("table.previous")}
          </Button>
          <Button variant="outline" size="sm" disabled={!hasMore} onClick={() => onPageChange(page + 1)}>
            {t("table.next")}
            <ChevronRight aria-hidden="true" />
          </Button>
        </nav>
      )}
    </div>
  );
}

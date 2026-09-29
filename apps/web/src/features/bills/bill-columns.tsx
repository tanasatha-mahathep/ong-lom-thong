import { Link } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { type ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import { EMPTY, formatMoney, formatWeight } from "@/lib/format";
import { formatDocDateTime } from "@/lib/thai-date";
import { cn } from "@/lib/utils";
import { type Bill } from "./api";
import { type BillsKey, type BillsT } from "./i18n";

type BadgeVariant = ComponentProps<typeof Badge>["variant"];

/** ป้ายสถานะ PDF — ค่าที่ไม่รู้จักแสดงข้อความดิบ (Map: ไม่ชนชื่อ property ของ Object) */
const PDF_BADGES = new Map<string, { label: BillsKey; variant: BadgeVariant }>([
  ["ready", { label: "pdf.ready", variant: "secondary" }],
  ["pending", { label: "pdf.pending", variant: "outline" }],
  ["failed", { label: "pdf.failed", variant: "destructive" }],
  ["invalid", { label: "pdf.invalid", variant: "destructive" }],
]);

const isVoid = (bill: Bill) => bill.status === "void";

/** บิลยกเลิก: ตัวอักษรจาง (muted-foreground ยังผ่าน AA) — ไม่ใช้ opacity ที่ทำให้ contrast ต่ำกว่าเกณฑ์ */
const voidText = (bill: Bill) => isVoid(bill) && "text-muted-foreground";

export interface BillColumnsOptions {
  t: BillsT;
  /** คอลัมน์สาขา — เมื่อค้นหลายสาขาพร้อมกัน */
  showBranch: boolean;
  /** การ์ดบิลวันนี้: เวลาอย่างเดียว · ไม่มีผู้บันทึก/สถานะ (บิลยกเลิกติดป้ายข้างเลขที่แทน) */
  compact: boolean;
}

/**
 * คอลัมน์ของตารางบิล — ลิงก์เลขที่เป็นสิ่งเดียวที่กดได้ในแถว (ไม่ใช้ onRowActivate: Tab ไปทีละบิลด้วยลิงก์จริง)
 * เงิน/น้ำหนักแสดงข้อความจาก API ผ่าน lib/format · บิลยกเลิกขีดฆ่ายอด (ยอดรวมท้ายตารางไม่นับ)
 */
export function makeBillColumns({ t, showBranch, compact }: BillColumnsOptions): ColumnDef<Bill>[] {
  const statusBadge = (bill: Bill) => {
    if (bill.status === "active") return null;
    return <Badge variant="destructive">{isVoid(bill) ? t("status.void") : bill.status}</Badge>;
  };

  return [
    {
      id: "doc_no",
      header: t("columns.docNo"),
      cell: ({ row: { original: bill } }) => (
        <span className="flex flex-wrap items-center gap-x-2">
          <Link
            to="/buy/$id"
            params={{ id: bill.id }}
            className={cn(
              "inline-flex min-h-6 items-center font-semibold whitespace-nowrap underline-offset-4 hover:underline",
              voidText(bill),
            )}
          >
            {bill.doc_no}
          </Link>
          {compact && statusBadge(bill)}
        </span>
      ),
    },
    {
      id: "date",
      header: compact ? t("columns.time") : t("columns.date"),
      cell: ({ row: { original: bill } }) => (
        <span className={cn("whitespace-nowrap tabular-nums", voidText(bill))}>
          {compact ? bill.time : formatDocDateTime(bill.date, bill.time)}
        </span>
      ),
    },
    ...(showBranch
      ? [
          {
            id: "branch",
            header: t("columns.branch"),
            cell: ({ row: { original: bill } }) => (
              <span className={cn(voidText(bill))}>{bill.branch?.name ?? EMPTY}</span>
            ),
          } satisfies ColumnDef<Bill>,
        ]
      : []),
    {
      id: "customer",
      header: t("columns.customer"),
      cell: ({ row: { original: bill } }) => (
        <span className={cn("grid", voidText(bill))}>
          <span>{bill.customer.name_th}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{bill.customer.national_id_masked}</span>
        </span>
      ),
    },
    {
      id: "total_weight",
      header: t("columns.weight"),
      meta: { numeric: true },
      cell: ({ row: { original: bill } }) => (
        <span className={cn(isVoid(bill) && "text-muted-foreground line-through")}>
          {formatWeight(bill.total_weight)}
        </span>
      ),
    },
    {
      id: "total_amount",
      header: t("columns.amount"),
      meta: { numeric: true },
      cell: ({ row: { original: bill } }) => (
        <span className={cn(isVoid(bill) && "text-muted-foreground line-through")}>
          {formatMoney(bill.total_amount)}
        </span>
      ),
    },
    ...(compact
      ? []
      : [
          {
            id: "created_by",
            header: t("columns.createdBy"),
            cell: ({ row: { original: bill } }) => <span className={cn(voidText(bill))}>{bill.created_by.name}</span>,
          } satisfies ColumnDef<Bill>,
          {
            id: "status",
            header: t("columns.status"),
            cell: ({ row: { original: bill } }) => statusBadge(bill),
          } satisfies ColumnDef<Bill>,
        ]),
    {
      id: "pdf_status",
      header: t("columns.pdf"),
      cell: ({ row: { original: bill } }) => {
        const badge = PDF_BADGES.get(bill.pdf_status);
        return <Badge variant={badge?.variant ?? "outline"}>{badge ? t(badge.label) : bill.pdf_status}</Badge>;
      },
    },
  ];
}

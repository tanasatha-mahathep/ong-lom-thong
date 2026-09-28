import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import { CircleAlert, Plus, TriangleAlert, X } from "lucide-react";
import { type MouseEvent, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EMPTY } from "@/lib/format";
import { useMe } from "@/lib/queries";
import { AdminOnlyNotice } from "./admin-only";
import type { AdminBranch, AffectedUser } from "./api";
import { BranchForm } from "./branch-form";
import { type BranchFormValues, branchValuesOf, newBranchValues, toBranchCreate, toBranchUpdate } from "./branch-model";
import { focusMarkedField, useReturnFocus } from "./dialog-focus";
import { isForbidden } from "./errors";
import { useTranslation } from "./i18n";
import { adminBranchesQuery, useCreateBranch, useUpdateBranch } from "./queries";

/** /settings/branches — ผู้ดูแลระบบเท่านั้น (role อื่นเห็นข้อความแทน ไม่ยิง API · API ตอบ 403 อยู่แล้ว) */
export function BranchesPage() {
  const { role } = useMe();
  if (role !== "admin") {
    return (
      <>
        <PageHeader />
        <AdminOnlyNotice />
      </>
    );
  }
  return <BranchesAdmin />;
}

type Editor = { mode: "create" } | { mode: "edit"; branch: AdminBranch };
/** สาขาที่เพิ่งปิดแต่ยังมีผู้ใช้ผูกอยู่ — แจ้งค้างไว้จนกว่าจะปิดข้อความ */
interface ClosedBranch {
  branch: AdminBranch;
  users: AffectedUser[];
}

const column = createColumnHelper<AdminBranch>();

function BranchesAdmin() {
  const { t } = useTranslation("settings");
  const list = useQuery(adminBranchesQuery);
  const branches = list.data ?? [];
  const create = useCreateBranch();
  const update = useUpdateBranch();
  const returnFocus = useReturnFocus();
  /** ข้อมูลของ Sheet — คงไว้ตอนปิด (เนื้อหาไม่หายระหว่างเลื่อนออก) */
  const [editor, setEditor] = useState<Editor>({ mode: "create" });
  const [open, setOpen] = useState(false);
  const [closed, setClosed] = useState<ClosedBranch | null>(null);

  const openEditor = useCallback(
    (next: Editor, event: MouseEvent<HTMLElement>) => {
      returnFocus.remember(event.currentTarget);
      setEditor(next);
      setOpen(true);
    },
    [returnFocus],
  );

  const save = async (values: BranchFormValues) => {
    if (editor.mode === "edit") {
      const before = editor.branch;
      const { branch, affected_users } = await update.mutateAsync({
        id: before.id,
        input: toBranchUpdate(values, before),
      });
      setOpen(false);
      toast.success(t("branches.saved.updated", { name: branch.name }));
      // เพิ่งปิดสาขา — ผู้ใช้ที่ยังผูกอยู่ต้องรู้ (โดยเฉพาะคนที่ไม่เหลือสาขาให้ทำงาน)
      if (before.is_active && !branch.is_active && affected_users.length > 0) {
        setClosed({ branch, users: affected_users });
      }
      return;
    }
    const branch = await create.mutateAsync(toBranchCreate(values));
    setOpen(false);
    toast.success(t("branches.saved.created", { name: branch.name }));
  };

  const columns = useMemo(
    () => [
      column.accessor("code", {
        header: t("branches.columns.code"),
        cell: (info) => <span className="font-mono tabular-nums">{info.getValue()}</span>,
      }),
      column.accessor("name", {
        header: t("branches.columns.name"),
        // ปุ่มจริง = ทางหลักของคีย์บอร์ด/screen reader ในการเปิดฟอร์มแก้ไข
        cell: (info) => (
          <button
            type="button"
            className="text-left font-medium underline-offset-4 hover:underline"
            aria-label={t("branches.edit", { name: info.getValue() })}
            onClick={(event) => openEditor({ mode: "edit", branch: info.row.original }, event)}
          >
            {info.getValue()}
          </button>
        ),
      }),
      column.accessor("short_name", {
        header: t("branches.columns.shortName"),
        cell: (info) => info.getValue() ?? EMPTY,
      }),
      column.accessor("tax_branch_code", {
        header: t("branches.columns.taxBranch"),
        cell: (info) => {
          const { tax_branch_code: code, tax_branch_label: label } = info.row.original;
          return code && label ? (
            <span className="whitespace-nowrap tabular-nums">{t("branches.taxBranch", { code, label })}</span>
          ) : (
            <span className="text-destructive">{t("branches.taxMissing")}</span>
          );
        },
      }),
      column.accessor("doc_prefix", {
        header: t("branches.columns.docPrefix"),
        cell: (info) => <span className="font-mono">{info.getValue() ?? EMPTY}</span>,
      }),
      column.accessor("sort_order", {
        header: t("branches.columns.sortOrder"),
        meta: { numeric: true },
      }),
      column.accessor("is_active", {
        header: t("branches.columns.status"),
        cell: (info) =>
          info.getValue() ? (
            <Badge variant="secondary">{t("branches.status.active")}</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              {t("branches.status.inactive")}
            </Badge>
          ),
      }),
      column.accessor("has_bills", {
        header: t("branches.columns.bills"),
        cell: (info) =>
          info.getValue() ? (
            t("branches.bills.yes")
          ) : (
            <span className="text-muted-foreground">{t("branches.bills.no")}</span>
          ),
      }),
    ],
    [t, openEditor],
  );

  const forbidden = isForbidden(list.error);

  return (
    <>
      <PageHeader
        description={t("branches.description")}
        actions={
          !forbidden && (
            <Button type="button" onClick={(event) => openEditor({ mode: "create" }, event)}>
              <Plus aria-hidden="true" />
              {t("branches.add")}
            </Button>
          )
        }
      />
      {closed && <ClosedBranchNotice closed={closed} onDismiss={() => setClosed(null)} />}
      {forbidden ? (
        <AdminOnlyNotice />
      ) : (
        <>
          {list.isError && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription className="flex flex-wrap items-center gap-3 text-destructive">
                {t("loadFailed", { ns: "common", what: t("branches.list") })}
                <Button type="button" variant="outline" size="sm" onClick={() => void list.refetch()}>
                  {t("retry", { ns: "common" })}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <DataTable
            caption={t("branches.caption")}
            columns={columns}
            data={branches}
            getRowId={(branch) => branch.id}
            page={1}
            hasMore={false}
            onPageChange={() => undefined}
            isLoading={list.isPending}
            emptyMessage={t("branches.empty")}
          />
        </>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          className="w-full gap-0 overflow-y-auto sm:max-w-lg"
          onOpenAutoFocus={focusMarkedField}
          onCloseAutoFocus={returnFocus.restore}
        >
          <SheetHeader>
            <SheetTitle>
              {editor.mode === "edit"
                ? t("branches.form.editTitle", { code: editor.branch.code })
                : t("branches.form.createTitle")}
            </SheetTitle>
            <SheetDescription>
              {editor.mode === "edit" ? editor.branch.name : t("branches.form.createDescription")}
            </SheetDescription>
          </SheetHeader>
          <BranchForm
            key={editor.mode === "edit" ? editor.branch.id : "new"}
            branch={editor.mode === "edit" ? editor.branch : undefined}
            defaultValues={editor.mode === "edit" ? branchValuesOf(editor.branch) : newBranchValues(branches)}
            onSubmit={save}
            onCancel={() => setOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

/** หลังปิดสาขา: ผู้ใช้ที่ยังผูกกับสาขานั้น (API ส่งมาใน affected_users) + ทางไปแก้ที่หน้าผู้ใช้ */
function ClosedBranchNotice({ closed, onDismiss }: { closed: ClosedBranch; onDismiss: () => void }) {
  const { t } = useTranslation("settings");
  const { branch, users } = closed;
  return (
    <Alert role="status" className="border-warning-border bg-warning pr-12 text-warning-foreground">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>{t("branches.affected.title", { name: branch.name, count: users.length })}</AlertTitle>
      <AlertDescription className="grid gap-3 text-warning-foreground">
        <p>{t("branches.affected.description")}</p>
        <ul className="grid list-disc gap-1 pl-5">
          {users.map((user) => (
            <li key={user.id}>
              {t("branches.affected.user", {
                name: user.name,
                email: user.email,
                via: t(user.via === "main" ? "branches.affected.main" : "branches.affected.allowed"),
              })}
              {user.becomes_branchless && <strong className="block">{t("branches.affected.branchless")}</strong>}
            </li>
          ))}
        </ul>
        <Button asChild variant="outline" size="sm" className="justify-self-start">
          <Link to="/settings/users" search={{ branch: branch.id }}>
            {t("branches.affected.manage")}
          </Link>
        </Button>
      </AlertDescription>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-2 right-2"
        aria-label={t("branches.affected.dismiss")}
        onClick={onDismiss}
      >
        <X aria-hidden="true" />
      </Button>
    </Alert>
  );
}

import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import { CircleAlert, KeyRound, UserPlus } from "lucide-react";
import { type MouseEvent, useCallback, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { errorMessage } from "@/lib/api";
import { EMPTY } from "@/lib/format";
import { useMe } from "@/lib/queries";
import { AdminOnlyNotice } from "./admin-only";
import type { AdminUser } from "./api";
import { focusMarkedField, useReturnFocus } from "./dialog-focus";
import { isForbidden } from "./errors";
import { FormAlert } from "./form-controls";
import { useTranslation } from "./i18n";
import { adminBranchesQuery, adminUsersQuery, useCreateUser, useResetPassword, useUpdateUser } from "./queries";
import { type TemporarySecret, TemporaryPasswordDialog } from "./temporary-password-dialog";
import { UserFilters } from "./user-filters";
import { UserForm } from "./user-form";
import { NEW_USER, type UserFormValues, toUserCreate, toUserUpdate, userValuesOf } from "./user-model";
import type { UsersSearch } from "./users-search";

const route = getRouteApi("/_app/settings/users");

/** /settings/users — ผู้ดูแลระบบเท่านั้น (role อื่นเห็นข้อความแทน ไม่ยิง API · API ตอบ 403 อยู่แล้ว) */
export function UsersPage() {
  const { role } = useMe();
  if (role !== "admin") {
    return (
      <>
        <PageHeader />
        <AdminOnlyNotice />
      </>
    );
  }
  return <UsersAdmin />;
}

type Editor = { mode: "create" } | { mode: "edit"; user: AdminUser };

const column = createColumnHelper<AdminUser>();

function UsersAdmin() {
  const { t } = useTranslation("settings");
  const me = useMe();
  const ids = useId();
  const selfResetReasonId = `${ids}-self-reset`;
  const search = route.useSearch();
  const navigate = route.useNavigate();

  const filters = { q: search.q, branch: search.branch, role: search.role, active: search.active };
  const list = useQuery(adminUsersQuery(filters));
  const branchList = useQuery(adminBranchesQuery);
  const branches = useMemo(() => branchList.data ?? [], [branchList.data]);
  const closedBranchIds = useMemo(() => new Set(branches.filter((b) => !b.is_active).map((b) => b.id)), [branches]);

  const create = useCreateUser();
  const update = useUpdateUser();
  const resetPassword = useResetPassword();
  const clearResetState = resetPassword.reset;
  const returnFocus = useReturnFocus();
  /** ข้อมูลของ Sheet — คงไว้ตอนปิด (เนื้อหาไม่หายระหว่างเลื่อนออก) */
  const [editor, setEditor] = useState<Editor>({ mode: "create" });
  const [editorOpen, setEditorOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  /** รหัสผ่านชั่วคราว — ที่เดียวที่เก็บ (state ของหน้า) · ปิด dialog = null */
  const [secret, setSecret] = useState<TemporarySecret | null>(null);

  const setFilters = (patch: Partial<UsersSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const openEditor = useCallback(
    (next: Editor, event: MouseEvent<HTMLElement>) => {
      returnFocus.remember(event.currentTarget);
      setEditor(next);
      setEditorOpen(true);
    },
    [returnFocus],
  );
  const openReset = useCallback(
    (user: AdminUser, event: MouseEvent<HTMLElement>) => {
      returnFocus.remember(event.currentTarget);
      clearResetState();
      setResetTarget(user);
    },
    [returnFocus, clearResetState],
  );

  const save = async (values: UserFormValues) => {
    if (editor.mode === "edit") {
      const self = editor.user.id === me.user.id;
      const { user, sessions_revoked } = await update.mutateAsync({
        id: editor.user.id,
        input: toUserUpdate(values, self),
      });
      setEditorOpen(false);
      toast.success(t("users.saved.updated", { name: user.name }), {
        description: sessions_revoked > 0 ? t("users.saved.sessionsRevoked", { count: sessions_revoked }) : undefined,
      });
      return;
    }
    try {
      const user = await create.mutateAsync(toUserCreate(values));
      const password = create.takeTemporaryPassword();
      if (password) {
        // Sheet ปิดแล้ว dialog รหัสผ่านรับโฟกัสต่อ — ปิด dialog แล้วโฟกัสกลับปุ่ม "เพิ่มผู้ใช้"
        returnFocus.handOff();
        setSecret({ name: user.name, email: user.email, password });
      } else {
        toast.success(t("users.saved.created", { name: user.name }));
      }
      setEditorOpen(false);
    } finally {
      // variables อาจมีรหัสผ่านที่ผู้ดูแลตั้งเอง — ปลด mutation ออกจาก cache (gcTime 0)
      create.reset();
    }
  };

  const confirmReset = (user: AdminUser) => {
    if (resetPassword.isPending) return;
    resetPassword.mutate(user.id, {
      onSuccess: ({ sessionsRevoked }) => {
        const password = resetPassword.takeTemporaryPassword();
        if (password) {
          returnFocus.handOff();
          setSecret({ name: user.name, email: user.email, password, sessionsRevoked });
        }
        setResetTarget(null);
      },
    });
  };

  const branchLabel = useCallback(
    (branch: { id: string; code: string; name: string }) => {
      const label = t("branchLabel", { code: branch.code, name: branch.name });
      return closedBranchIds.has(branch.id) ? t("users.branchClosed", { branch: label }) : label;
    },
    [t, closedBranchIds],
  );

  const columns = useMemo(
    () => [
      column.accessor("name", {
        header: t("users.columns.name"),
        // ปุ่มจริง = ทางหลักของคีย์บอร์ด/screen reader ในการเปิดฟอร์มแก้ไข
        cell: (info) => (
          <span className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="text-left font-medium underline-offset-4 hover:underline"
              aria-label={t("users.edit", { name: info.getValue() })}
              onClick={(event) => openEditor({ mode: "edit", user: info.row.original }, event)}
            >
              {info.getValue()}
            </button>
            {info.row.original.id === me.user.id && <Badge variant="outline">{t("users.you")}</Badge>}
          </span>
        ),
      }),
      column.accessor("email", {
        header: t("users.columns.email"),
        cell: (info) => <span className="break-all">{info.getValue()}</span>,
      }),
      column.accessor("role", {
        header: t("users.columns.role"),
        cell: (info) => (
          <Badge variant={info.getValue() === "admin" ? "default" : "secondary"}>
            {t(`roles.${info.getValue()}`, { ns: "common" })}
          </Badge>
        ),
      }),
      column.accessor("branch", {
        header: t("users.columns.branch"),
        cell: (info) => {
          const branch = info.getValue();
          return branch ? branchLabel(branch) : EMPTY;
        },
      }),
      column.accessor("allowed_branches", {
        header: t("users.columns.allowed"),
        cell: (info) => {
          const allowed = info.getValue();
          if (allowed.length === 0) return EMPTY;
          return (
            <ul className="grid gap-0.5">
              {allowed.map((branch) => (
                <li key={branch.id} className="whitespace-nowrap">
                  {branchLabel(branch)}
                </li>
              ))}
            </ul>
          );
        },
      }),
      column.accessor("can_view_all", {
        header: t("users.columns.viewAll"),
        cell: (info) =>
          info.getValue() ? (
            t("users.viewAll.yes")
          ) : (
            <span className="text-muted-foreground">{t("users.viewAll.no")}</span>
          ),
      }),
      column.accessor("is_active", {
        header: t("users.columns.status"),
        cell: (info) =>
          info.getValue() ? (
            <Badge variant="secondary">{t("users.status.active")}</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              {t("users.status.inactive")}
            </Badge>
          ),
      }),
      column.display({
        id: "actions",
        header: t("users.columns.actions"),
        cell: (info) => {
          const user = info.row.original;
          // ตั้งรหัสใหม่ให้ตัวเอง = session นี้ถูกลบทันที หน้าเด้งไป login ก่อนได้เห็นรหัสใหม่
          const self = user.id === me.user.id;
          return (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={t("users.reset.actionFor", { name: user.name })}
              aria-disabled={self || undefined}
              aria-describedby={self ? selfResetReasonId : undefined}
              title={self ? t("users.reset.self") : undefined}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              onClick={(event) => {
                if (!self) openReset(user, event);
              }}
            >
              <KeyRound aria-hidden="true" />
              {t("users.reset.action")}
            </Button>
          );
        },
      }),
    ],
    [t, me.user.id, openEditor, openReset, branchLabel, selfResetReasonId],
  );

  const forbidden = isForbidden(list.error) || isForbidden(branchList.error);
  const filtered =
    search.q !== "" || search.branch !== undefined || search.role !== undefined || search.active !== undefined;
  const editingSelf = editor.mode === "edit" && editor.user.id === me.user.id;

  return (
    <>
      <PageHeader
        description={t("users.description")}
        actions={
          !forbidden && (
            <Button type="button" onClick={(event) => openEditor({ mode: "create" }, event)}>
              <UserPlus aria-hidden="true" />
              {t("users.add")}
            </Button>
          )
        }
      />
      {forbidden ? (
        <AdminOnlyNotice />
      ) : (
        <>
          <UserFilters search={search} branches={branches} onChange={setFilters} />
          {list.isError && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription className="flex flex-wrap items-center gap-3 text-destructive">
                {t("loadFailed", { ns: "common", what: t("users.list") })}
                <Button type="button" variant="outline" size="sm" onClick={() => void list.refetch()}>
                  {t("retry", { ns: "common" })}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <DataTable
            caption={t(filtered ? "users.captionFiltered" : "users.caption")}
            columns={columns}
            data={list.data ?? []}
            getRowId={(user) => user.id}
            page={1}
            hasMore={false}
            onPageChange={() => undefined}
            isLoading={list.isPending}
            emptyMessage={t(filtered ? "users.emptyFiltered" : "users.empty")}
          />
          <p id={selfResetReasonId} className="sr-only">
            {t("users.reset.self")}
          </p>
        </>
      )}

      <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
        <SheetContent
          className="w-full gap-0 overflow-y-auto sm:max-w-lg"
          onOpenAutoFocus={focusMarkedField}
          onCloseAutoFocus={returnFocus.restore}
        >
          <SheetHeader>
            <SheetTitle>{t(editor.mode === "edit" ? "users.form.editTitle" : "users.form.createTitle")}</SheetTitle>
            <SheetDescription>
              {editor.mode === "edit" ? editor.user.email : t("users.form.createDescription")}
            </SheetDescription>
          </SheetHeader>
          <UserForm
            key={editor.mode === "edit" ? editor.user.id : "new"}
            user={editor.mode === "edit" ? editor.user : undefined}
            self={editingSelf}
            branches={branches}
            defaultValues={editor.mode === "edit" ? userValuesOf(editor.user) : NEW_USER}
            onSubmit={save}
            onCancel={() => setEditorOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={resetTarget !== null}
        onOpenChange={(open) => {
          if (!open && !resetPassword.isPending) setResetTarget(null);
        }}
      >
        {resetTarget && (
          <AlertDialogContent onCloseAutoFocus={returnFocus.restore}>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("users.reset.title", { name: resetTarget.name })}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("users.reset.description", { email: resetTarget.email })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {resetPassword.isError && (
              <FormAlert>
                {isForbidden(resetPassword.error) ? t("form.forbidden") : errorMessage(resetPassword.error)}
              </FormAlert>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={resetPassword.isPending}>{t("users.reset.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                aria-disabled={resetPassword.isPending || undefined}
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                onClick={(event) => {
                  // ปิดเองเมื่อสำเร็จ — ระหว่างส่งและเมื่อ error ต้องอยู่ต่อ
                  event.preventDefault();
                  confirmReset(resetTarget);
                }}
              >
                {t(resetPassword.isPending ? "users.reset.pending" : "users.reset.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>

      <TemporaryPasswordDialog secret={secret} onClose={() => setSecret(null)} onCloseAutoFocus={returnFocus.restore} />
    </>
  );
}

import { useForm, useStore } from "@tanstack/react-form";
import { TriangleAlert } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ROLES, type Role } from "@/lib/queries";
import type { AdminBranch, AdminUser } from "./api";
import { type SaveError, saveErrorOf } from "./errors";
import { CheckboxField, FormAlert, FormFooter, TextField } from "./form-controls";
import { isSettingsKey, useTranslation } from "./i18n";
import {
  PASSWORD_LIMITS,
  USER_FIELDS,
  type UserField,
  type UserFormValues,
  checkEmail,
  checkName,
  checkPassword,
  hasNoBranch,
  selectableBranches,
} from "./user-model";

export interface UserFormProps {
  /** ผู้ใช้ที่แก้ — ไม่ส่ง = เพิ่มผู้ใช้ใหม่ */
  user?: AdminUser;
  /** บัญชีของผู้ดูแลที่ login อยู่ — บทบาทและสถานะเปิด/ปิดแก้ไม่ได้ */
  self: boolean;
  /** ทุกสาขา (รวมที่ปิด) จาก GET /api/admin/branches */
  branches: readonly AdminBranch[];
  /** อ่านครั้งเดียวตอน mount */
  defaultValues: UserFormValues;
  /** บันทึก — throw ApiError เมื่อไม่สำเร็จ (ฟอร์มแสดงใต้ช่องที่ API ชี้) */
  onSubmit: (values: UserFormValues) => Promise<void>;
  onCancel: () => void;
}

const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value);

/** โฟกัสช่องที่มีปัญหา — กลุ่ม (radio · checkbox list) โฟกัสตัวที่เลือกอยู่หรือตัวแรก */
function focusField(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  // selector หลายตัวใน querySelector เดียวคืนตัวแรกตามลำดับ DOM — หาตัวที่เลือกอยู่ก่อนจึงแยกสองรอบ
  const target = element.matches("input, select, textarea, button")
    ? element
    : (element.querySelector<HTMLElement>("[data-state=checked]:not(:disabled)") ??
      element.querySelector<HTMLElement>("button:not(:disabled), select, input:not([aria-hidden=true])"));
  target?.focus();
}

const describedBy = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;

/**
 * ฟอร์มผู้ใช้ (เพิ่ม/แก้) — อีเมลแก้ไม่ได้หลังเพิ่ม · รหัสผ่านมีเฉพาะตอนเพิ่ม (ไม่กรอก = ระบบสุ่มและแสดงครั้งเดียว)
 * บัญชีตัวเอง: บทบาทและสถานะปิดไว้พร้อมเหตุผล (API ห้ามลดสิทธิ์/ปิดตัวเองอยู่แล้ว — กันไว้ก่อนถึงเซิร์ฟเวอร์)
 */
export function UserForm({ user, self, branches, defaultValues, onSubmit, onCancel }: UserFormProps) {
  const { t } = useTranslation("settings");
  const ids = useId();
  const idOf = (name: UserField) => `${ids}-${name}`;
  const selfReasonId = `${ids}-self`;
  const editing = user !== undefined;
  const [initialValues] = useState(defaultValues);
  const [serverError, setServerError] = useState<SaveError | null>(null);
  const busy = useRef(false);
  const saveButton = useRef<HTMLButtonElement>(null);

  const form = useForm({
    defaultValues: initialValues,
    canSubmitWhenInvalid: true,
    onSubmitInvalid: ({ formApi }) => {
      const first = USER_FIELDS.find((name) => (formApi.getFieldMeta(name)?.errors ?? []).some(isSettingsKey));
      if (first) focusField(idOf(first));
    },
    onSubmit: async ({ value }) => {
      setServerError(null);
      try {
        await onSubmit(value);
      } catch (error) {
        const mapped = saveErrorOf(error, USER_FIELDS);
        setServerError(mapped);
        if (mapped.field) focusField(`${ids}-${mapped.field}`);
        else saveButton.current?.focus();
      }
    },
  });
  const submitting = useStore(form.store, (state) => state.isSubmitting);
  const mainBranch = useStore(form.store, (state) => state.values.branch_id);
  const viewAll = useStore(form.store, (state) => state.values.can_view_all);
  const noBranch = useStore(form.store, (state) => hasNoBranch(state.values));

  const submit = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      await form.handleSubmit();
    } finally {
      busy.current = false;
    }
  };
  const onFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  };

  const serverMessage = (name: UserField) => (serverError?.field === name ? [serverError.message] : []);
  const errorsOf = (name: UserField, errors: readonly unknown[]) => [
    ...new Set([...errors.filter(isSettingsKey).map((key) => t(key, PASSWORD_LIMITS)), ...serverMessage(name)]),
  ];
  const clearServerError = (name: UserField) => {
    if (serverError?.field === name) setServerError(null);
  };
  const formError = serverError && !serverError.field ? serverError : null;
  const branchLabel = (branch: AdminBranch) => {
    const label = t("branchLabel", { code: branch.code, name: branch.name });
    return branch.is_active ? label : t("users.branchClosed", { branch: label });
  };

  return (
    <form
      noValidate
      autoComplete="off"
      aria-label={editing ? t("users.form.editTitle") : t("users.form.createTitle")}
      onSubmit={onFormSubmit}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-6 px-4 pb-6"
    >
      {self && (
        <p id={selfReasonId} className="rounded-md border bg-muted p-3 text-sm">
          {t("users.form.self")}
        </p>
      )}

      <FieldGroup className="gap-5">
        <form.Field name="name" validators={{ onSubmit: checkName }}>
          {(field) => (
            <TextField
              id={idOf("name")}
              label={t("users.form.fields.name.label")}
              errors={errorsOf("name", field.state.meta.errors)}
              value={field.state.value}
              required
              maxLength={100}
              data-autofocus
              onValueChange={(value) => {
                field.handleChange(value);
                clearServerError("name");
              }}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>

        <form.Field name="email" validators={editing ? undefined : { onSubmit: checkEmail }}>
          {(field) => (
            <TextField
              id={idOf("email")}
              type="email"
              label={t("users.form.fields.email.label")}
              hint={t(editing ? "users.form.fields.email.locked" : "users.form.fields.email.hint")}
              errors={errorsOf("email", field.state.meta.errors)}
              value={field.state.value}
              readOnly={editing}
              required={!editing}
              maxLength={254}
              spellCheck={false}
              autoCapitalize="none"
              className="read-only:bg-muted"
              onValueChange={(value) => {
                field.handleChange(value);
                clearServerError("email");
              }}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>

        <form.Field name="role">
          {(field) => {
            const errors = serverMessage("role");
            const legendId = `${idOf("role")}-legend`;
            const errorId = `${idOf("role")}-error`;
            return (
              <FieldSet data-invalid={errors.length > 0 || undefined}>
                <FieldLegend id={legendId} variant="label">
                  {t("users.form.fields.role.label")}
                </FieldLegend>
                <RadioGroup
                  id={idOf("role")}
                  aria-labelledby={legendId}
                  aria-describedby={describedBy(self && selfReasonId, errors.length > 0 && errorId)}
                  value={field.state.value}
                  disabled={self}
                  onValueChange={(value) => {
                    if (!isRole(value)) return;
                    field.handleChange(value);
                    clearServerError("role");
                  }}
                >
                  {ROLES.map((role) => {
                    const itemId = `${idOf("role")}-${role}`;
                    return (
                      <div key={role} className="flex items-start gap-3">
                        <RadioGroupItem
                          id={itemId}
                          value={role}
                          aria-describedby={`${itemId}-hint`}
                          className="mt-0.5"
                        />
                        <div className="grid gap-1">
                          <Label htmlFor={itemId}>{t(`roles.${role}`, { ns: "common" })}</Label>
                          <p id={`${itemId}-hint`} className="text-sm text-muted-foreground">
                            {t(`users.roleHints.${role}`)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </RadioGroup>
                {errors.length > 0 && <FieldError id={errorId}>{errors.join(" · ")}</FieldError>}
              </FieldSet>
            );
          }}
        </form.Field>

        <form.Field name="branch_id">
          {(field) => {
            const errors = serverMessage("branch_id");
            const selectId = idOf("branch_id");
            return (
              <Field data-invalid={errors.length > 0 || undefined}>
                <FieldLabel htmlFor={selectId}>{t("users.form.fields.branch_id.label")}</FieldLabel>
                <NativeSelect
                  id={selectId}
                  value={field.state.value}
                  aria-invalid={errors.length > 0 || undefined}
                  aria-describedby={describedBy(`${selectId}-hint`, errors.length > 0 && `${selectId}-error`)}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                    clearServerError("branch_id");
                  }}
                >
                  <NativeSelectOption value="">{t("users.form.fields.branch_id.none")}</NativeSelectOption>
                  {selectableBranches(branches, [initialValues.branch_id]).map((branch) => (
                    <NativeSelectOption key={branch.id} value={branch.id}>
                      {branchLabel(branch)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldDescription id={`${selectId}-hint`}>{t("users.form.fields.branch_id.hint")}</FieldDescription>
                {errors.length > 0 && <FieldError id={`${selectId}-error`}>{errors.join(" · ")}</FieldError>}
              </Field>
            );
          }}
        </form.Field>

        <form.Field name="allowed_branch_ids">
          {(field) => {
            const errors = serverMessage("allowed_branch_ids");
            const groupId = idOf("allowed_branch_ids");
            const options = selectableBranches(branches, initialValues.allowed_branch_ids);
            return (
              <FieldSet
                id={groupId}
                data-invalid={errors.length > 0 || undefined}
                aria-describedby={describedBy(`${groupId}-hint`, errors.length > 0 && `${groupId}-error`)}
              >
                <FieldLegend variant="label">{t("users.form.fields.allowed_branch_ids.label")}</FieldLegend>
                <FieldDescription id={`${groupId}-hint`}>
                  {t(
                    viewAll
                      ? "users.form.fields.allowed_branch_ids.viewAll"
                      : "users.form.fields.allowed_branch_ids.hint",
                  )}
                </FieldDescription>
                {options.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("users.form.fields.allowed_branch_ids.empty")}</p>
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {options.map((branch) => {
                      const boxId = `${groupId}-${branch.id}`;
                      // สาขาหลักทำงานได้อยู่แล้ว — ติ๊กไว้และปิดช่อง (ไม่ต้องเพิ่มซ้ำใน allowed_branch_ids)
                      const isMain = branch.id === mainBranch;
                      return (
                        <li key={branch.id} className="flex items-center gap-2">
                          <Checkbox
                            id={boxId}
                            checked={isMain || field.state.value.includes(branch.id)}
                            disabled={isMain}
                            aria-describedby={isMain || !branch.is_active ? `${boxId}-tag` : undefined}
                            onCheckedChange={(checked) => {
                              const rest = field.state.value.filter((id) => id !== branch.id);
                              field.handleChange(checked === true ? [...rest, branch.id] : rest);
                              clearServerError("allowed_branch_ids");
                            }}
                          />
                          <Label htmlFor={boxId} className="font-normal">
                            {t("branchLabel", { code: branch.code, name: branch.name })}
                          </Label>
                          {(isMain || !branch.is_active) && (
                            <Badge id={`${boxId}-tag`} variant="outline" className="text-muted-foreground">
                              {t(
                                isMain
                                  ? "users.form.fields.allowed_branch_ids.main"
                                  : "users.form.fields.allowed_branch_ids.closed",
                              )}
                            </Badge>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {errors.length > 0 && <FieldError id={`${groupId}-error`}>{errors.join(" · ")}</FieldError>}
              </FieldSet>
            );
          }}
        </form.Field>

        <form.Field name="can_view_all">
          {(field) => (
            <CheckboxField
              id={idOf("can_view_all")}
              label={t("users.form.fields.can_view_all.label")}
              hint={t("users.form.fields.can_view_all.hint")}
              errors={serverMessage("can_view_all")}
              checked={field.state.value}
              onCheckedChange={(checked) => {
                field.handleChange(checked);
                clearServerError("can_view_all");
              }}
            />
          )}
        </form.Field>

        {noBranch && (
          <p className="flex gap-2 rounded-md border border-warning-border bg-warning p-3 text-sm text-warning-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t("users.form.noBranch")}
          </p>
        )}

        {editing && (
          <form.Field name="is_active">
            {(field) => (
              <CheckboxField
                id={idOf("is_active")}
                label={t("users.form.fields.is_active.label")}
                hint={t("users.form.fields.is_active.hint")}
                errors={serverMessage("is_active")}
                checked={field.state.value}
                disabled={self}
                reasonId={self ? selfReasonId : undefined}
                onCheckedChange={(checked) => {
                  field.handleChange(checked);
                  clearServerError("is_active");
                }}
              />
            )}
          </form.Field>
        )}

        {!editing && (
          <form.Field name="password" validators={{ onBlur: checkPassword, onSubmit: checkPassword }}>
            {(field) => (
              <TextField
                id={idOf("password")}
                type="password"
                label={t("users.form.fields.password.label")}
                hint={t("users.form.fields.password.hint")}
                errors={errorsOf("password", field.state.meta.errors)}
                value={field.state.value}
                autoComplete="new-password"
                maxLength={PASSWORD_LIMITS.max}
                onValueChange={(value) => {
                  field.handleChange(value);
                  clearServerError("password");
                }}
                onBlur={field.handleBlur}
              />
            )}
          </form.Field>
        )}
      </FieldGroup>

      {formError && <FormAlert>{formError.forbidden ? t("form.forbidden") : formError.message}</FormAlert>}

      <FormFooter
        saveRef={saveButton}
        submitLabel={t(editing ? "users.form.save" : "users.form.create")}
        submitting={submitting}
        onCancel={onCancel}
      />
    </form>
  );
}

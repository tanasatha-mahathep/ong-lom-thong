import { useForm, useStore } from "@tanstack/react-form";
import { type FormEvent, type KeyboardEvent, useId, useRef, useState } from "react";
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
import { FieldGroup } from "@/components/ui/field";
import type { AdminBranch } from "./api";
import {
  BRANCH_FIELDS,
  type BranchField,
  type BranchFormValues,
  checkCode,
  checkDocPrefix,
  checkName,
  checkSortOrder,
  checkTaxCode,
  needsCloseConfirm,
} from "./branch-model";
import { type SaveError, saveErrorOf } from "./errors";
import { CheckboxField, FormAlert, FormFooter, TextField } from "./form-controls";
import { isSettingsKey, useTranslation } from "./i18n";

export interface BranchFormProps {
  /** สาขาที่แก้ — ไม่ส่ง = เพิ่มสาขาใหม่ */
  branch?: AdminBranch;
  /** อ่านครั้งเดียวตอน mount (refetch ระหว่างพิมพ์ไม่ล้างฟอร์ม) */
  defaultValues: BranchFormValues;
  /** บันทึก — throw ApiError เมื่อไม่สำเร็จ (ฟอร์มแสดงใต้ช่องที่ API ชี้) */
  onSubmit: (values: BranchFormValues) => Promise<void>;
  onCancel: () => void;
}

/** ตรวจตอนออกจากช่องเฉพาะเมื่อพิมพ์แล้ว — ช่องว่างเตือนตอนบันทึก (Tab ผ่านไม่ขึ้นสีแดง) */
const whenFilled =
  <T,>(check: (props: { value: string }) => T) =>
  ({ value }: { value: string }) =>
    value.trim() === "" ? undefined : check({ value });

const focusById = (id: string) => document.getElementById(id)?.focus();

/**
 * ฟอร์มสาขา (เพิ่ม/แก้) — code แก้ไม่ได้หลังเพิ่ม · doc_prefix แก้ไม่ได้เมื่อมีบิลแล้ว (API ตอบ 409 อยู่แล้ว ช่องจึงปิดไว้)
 * ปิดสาขาที่มีบิลแล้ว = ยืนยันก่อน · Enter/ปุ่ม/Ctrl+Enter บันทึก · error ของ API แสดงใต้ช่องที่ชี้
 */
export function BranchForm({ branch, defaultValues, onSubmit, onCancel }: BranchFormProps) {
  const { t } = useTranslation("settings");
  const ids = useId();
  const idOf = (name: BranchField) => `${ids}-${name}`;
  const editing = branch !== undefined;
  const prefixLocked = branch?.has_bills === true;
  const [initialValues] = useState(defaultValues);
  const [serverError, setServerError] = useState<SaveError | null>(null);
  const [closing, setClosing] = useState<BranchFormValues | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const saveButton = useRef<HTMLButtonElement>(null);

  const save = async (values: BranchFormValues) => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setServerError(null);
    try {
      await onSubmit(values);
    } catch (error) {
      const mapped = saveErrorOf(error, BRANCH_FIELDS);
      setServerError(mapped);
      if (mapped.field) focusById(`${ids}-${mapped.field}`);
      else saveButton.current?.focus();
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const form = useForm({
    defaultValues: initialValues,
    // error ที่ค้างจากตอนออกจากช่องต้องไม่ทำให้ปุ่มบันทึกเงียบ — ตอนบันทึกตรวจทุกช่องใหม่อยู่แล้ว
    canSubmitWhenInvalid: true,
    onSubmitInvalid: ({ formApi }) => {
      const first = BRANCH_FIELDS.find((name) => (formApi.getFieldMeta(name)?.errors ?? []).some(isSettingsKey));
      if (first) focusById(idOf(first));
    },
    onSubmit: async ({ value }) => {
      if (needsCloseConfirm(branch, value)) {
        setClosing(value);
        return;
      }
      await save(value);
    },
  });
  const submitting = useStore(form.store, (state) => state.isSubmitting) || saving;

  const submit = () => {
    if (busy.current) return;
    void form.handleSubmit();
  };
  const onFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  /** error ของช่อง: ของฟอร์ม (key) + ของ API ที่ชี้ช่องนี้ */
  const errorsOf = (name: BranchField, errors: readonly unknown[]) => [
    ...new Set([
      ...errors.filter(isSettingsKey).map((key) => t(key)),
      ...(serverError?.field === name ? [serverError.message] : []),
    ]),
  ];
  const clearServerError = (name: BranchField) => {
    if (serverError?.field === name) setServerError(null);
  };
  const formError = serverError && !serverError.field ? serverError : null;

  return (
    <form
      noValidate
      autoComplete="off"
      aria-label={editing ? t("branches.form.editTitle", { code: branch.code }) : t("branches.form.createTitle")}
      onSubmit={onFormSubmit}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-6 px-4 pb-6"
    >
      <FieldGroup className="gap-5">
        <form.Field
          name="code"
          validators={editing ? undefined : { onBlur: whenFilled(checkCode), onSubmit: checkCode }}
        >
          {(field) => (
            <TextField
              id={idOf("code")}
              label={t("branches.form.fields.code.label")}
              hint={t(editing ? "branches.form.fields.code.locked" : "branches.form.fields.code.hint")}
              errors={errorsOf("code", field.state.meta.errors)}
              value={field.state.value}
              readOnly={editing}
              required={!editing}
              inputMode="numeric"
              maxLength={5}
              className="font-mono tabular-nums read-only:bg-muted"
              data-autofocus={editing ? undefined : true}
              onValueChange={(value) => {
                field.handleChange(value);
                clearServerError("code");
              }}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>

        <form.Field name="name" validators={{ onSubmit: checkName }}>
          {(field) => (
            <TextField
              id={idOf("name")}
              label={t("branches.form.fields.name.label")}
              errors={errorsOf("name", field.state.meta.errors)}
              value={field.state.value}
              required
              maxLength={100}
              data-autofocus={editing ? true : undefined}
              onValueChange={(value) => {
                field.handleChange(value);
                clearServerError("name");
              }}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>

        <form.Field name="short_name">
          {(field) => (
            <TextField
              id={idOf("short_name")}
              label={t("branches.form.fields.short_name.label")}
              hint={t("branches.form.fields.short_name.hint")}
              errors={errorsOf("short_name", field.state.meta.errors)}
              value={field.state.value}
              maxLength={20}
              onValueChange={(value) => {
                field.handleChange(value);
                clearServerError("short_name");
              }}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>

        <form.Field name="tax_branch_code" validators={{ onBlur: checkTaxCode, onSubmit: checkTaxCode }}>
          {(field) => (
            <TextField
              id={idOf("tax_branch_code")}
              label={t("branches.form.fields.tax_branch_code.label")}
              hint={t("branches.form.fields.tax_branch_code.hint")}
              errors={errorsOf("tax_branch_code", field.state.meta.errors)}
              value={field.state.value}
              inputMode="numeric"
              maxLength={5}
              className="font-mono tabular-nums"
              onValueChange={(value) => {
                field.handleChange(value);
                clearServerError("tax_branch_code");
              }}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>

        <form.Field name="address">
          {(field) => (
            <TextField
              id={idOf("address")}
              label={t("branches.form.fields.address.label")}
              hint={t("branches.form.fields.address.hint")}
              errors={errorsOf("address", field.state.meta.errors)}
              value={field.state.value}
              multiline
              onValueChange={(value) => {
                field.handleChange(value);
                clearServerError("address");
              }}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>

        <form.Field name="tel">
          {(field) => (
            <TextField
              id={idOf("tel")}
              label={t("branches.form.fields.tel.label")}
              hint={t("branches.form.fields.tel.hint")}
              errors={errorsOf("tel", field.state.meta.errors)}
              value={field.state.value}
              inputMode="tel"
              maxLength={40}
              onValueChange={(value) => {
                field.handleChange(value);
                clearServerError("tel");
              }}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>

        <form.Field name="doc_prefix" validators={{ onBlur: checkDocPrefix, onSubmit: checkDocPrefix }}>
          {(field) => {
            const prefix = field.state.value.trim();
            const hint = prefixLocked
              ? t("branches.form.fields.doc_prefix.locked")
              : prefix && !checkDocPrefix({ value: prefix })
                ? t("branches.form.fields.doc_prefix.preview", { prefix })
                : t("branches.form.fields.doc_prefix.hint");
            return (
              <TextField
                id={idOf("doc_prefix")}
                label={t("branches.form.fields.doc_prefix.label")}
                hint={hint}
                errors={errorsOf("doc_prefix", field.state.meta.errors)}
                value={field.state.value}
                readOnly={prefixLocked}
                maxLength={4}
                className="font-mono uppercase read-only:bg-muted"
                // ตัวพิมพ์ใหญ่ทันที — API รับเฉพาะ A–Z
                onValueChange={(value) => {
                  field.handleChange(value.toUpperCase());
                  clearServerError("doc_prefix");
                }}
                onBlur={field.handleBlur}
              />
            );
          }}
        </form.Field>

        <form.Field name="sort_order" validators={{ onBlur: checkSortOrder, onSubmit: checkSortOrder }}>
          {(field) => (
            <TextField
              id={idOf("sort_order")}
              label={t("branches.form.fields.sort_order.label")}
              hint={t("branches.form.fields.sort_order.hint")}
              errors={errorsOf("sort_order", field.state.meta.errors)}
              value={field.state.value}
              inputMode="numeric"
              maxLength={4}
              className="w-32 tabular-nums"
              onValueChange={(value) => {
                field.handleChange(value);
                clearServerError("sort_order");
              }}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>

        <form.Field name="is_active">
          {(field) => (
            <CheckboxField
              id={idOf("is_active")}
              label={t("branches.form.fields.is_active.label")}
              hint={t("branches.form.fields.is_active.hint")}
              errors={serverError?.field === "is_active" ? [serverError.message] : []}
              checked={field.state.value}
              onCheckedChange={(checked) => {
                field.handleChange(checked);
                clearServerError("is_active");
              }}
            />
          )}
        </form.Field>
      </FieldGroup>

      {formError && <FormAlert>{formError.forbidden ? t("form.forbidden") : formError.message}</FormAlert>}

      <FormFooter
        saveRef={saveButton}
        submitLabel={t(editing ? "branches.form.save" : "branches.form.create")}
        submitting={submitting}
        onCancel={onCancel}
      />

      <AlertDialog
        open={closing !== null}
        onOpenChange={(open) => {
          if (!open) setClosing(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            // เปิดจากการกดบันทึก (ไม่มี Trigger) — กลับไปที่ปุ่มบันทึก
            event.preventDefault();
            saveButton.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t("branches.deactivate.title", { name: branch?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("branches.deactivate.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm">{t("branches.deactivate.users")}</p>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("branches.deactivate.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const values = closing;
                setClosing(null);
                if (values) void save(values);
              }}
            >
              {t("branches.deactivate.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

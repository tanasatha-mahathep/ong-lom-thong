import { CircleAlert, LoaderCircle } from "lucide-react";
import type { ComponentProps, ReactNode, Ref } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "./i18n";

/** ข้อความใต้ช่อง (คำอธิบาย · error) ผูกกับช่องด้วย aria-describedby */
const hintIdOf = (id: string) => `${id}-hint`;
const errorIdOf = (id: string) => `${id}-error`;
const describedBy = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;

interface TextFieldProps extends Omit<ComponentProps<"input">, "id" | "value" | "onChange" | "onBlur"> {
  id: string;
  label: string;
  hint?: ReactNode;
  /** ข้อความ error ที่แปลแล้ว (ของฟอร์ม + ของ API) */
  errors: readonly string[];
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: () => void;
  /** ที่อยู่ — Textarea (Enter ขึ้นบรรทัด · Ctrl+Enter บันทึก) */
  multiline?: boolean;
}

/** ช่องข้อความ + ป้าย + คำอธิบาย + error ใต้ช่อง (shadcn Field) */
export function TextField({
  id,
  label,
  hint,
  errors,
  value,
  onValueChange,
  onBlur,
  multiline = false,
  required,
  ...inputProps
}: TextFieldProps) {
  const invalid = errors.length > 0;
  const control = {
    id,
    value,
    onBlur,
    "aria-invalid": invalid || undefined,
    "aria-required": required || undefined,
    "aria-describedby": describedBy(hint !== undefined && hintIdOf(id), invalid && errorIdOf(id)),
  };
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {multiline ? (
        <Textarea rows={3} {...control} onChange={(event) => onValueChange(event.target.value)} />
      ) : (
        <Input type="text" {...inputProps} {...control} onChange={(event) => onValueChange(event.target.value)} />
      )}
      {hint !== undefined && <FieldDescription id={hintIdOf(id)}>{hint}</FieldDescription>}
      {invalid && <FieldError id={errorIdOf(id)}>{errors.join(" · ")}</FieldError>}
    </Field>
  );
}

interface CheckboxFieldProps {
  id: string;
  label: string;
  hint?: ReactNode;
  errors: readonly string[];
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** id ของข้อความอธิบายเพิ่ม เช่น เหตุผลที่ปิดช่องไว้ (บัญชีตัวเอง) */
  reasonId?: string;
}

/** checkbox + ป้าย (คลิกป้ายได้) + คำอธิบาย — Space สลับค่า */
export function CheckboxField({
  id,
  label,
  hint,
  errors,
  checked,
  onCheckedChange,
  disabled,
  reasonId,
}: CheckboxFieldProps) {
  const invalid = errors.length > 0;
  return (
    <Field orientation="horizontal" data-invalid={invalid || undefined} data-disabled={disabled || undefined}>
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy(hint !== undefined && hintIdOf(id), reasonId, invalid && errorIdOf(id))}
      />
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {hint !== undefined && <FieldDescription id={hintIdOf(id)}>{hint}</FieldDescription>}
        {invalid && <FieldError id={errorIdOf(id)}>{errors.join(" · ")}</FieldError>}
      </FieldContent>
    </Field>
  );
}

/** error ที่ไม่ได้ชี้ช่อง — ท้ายฟอร์ม เหนือปุ่มบันทึก */
export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertDescription className="text-destructive">{children}</AlertDescription>
    </Alert>
  );
}

/** ปุ่มบันทึก (กันกดซ้ำด้วย aria-disabled — ปุ่มไม่หลุดโฟกัส) + ยกเลิก + คำใบ้ Ctrl+Enter */
export function FormFooter({
  submitLabel,
  submitting,
  onCancel,
  saveRef,
}: {
  submitLabel: string;
  submitting: boolean;
  onCancel: () => void;
  saveRef?: Ref<HTMLButtonElement>;
}) {
  const { t } = useTranslation("settings");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        ref={saveRef}
        type="submit"
        aria-disabled={submitting || undefined}
        aria-keyshortcuts="Control+Enter"
        className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      >
        {submitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
        {submitting ? t("saving", { ns: "common" }) : submitLabel}
      </Button>
      <Button type="button" variant="outline" onClick={onCancel}>
        {t("form.cancel")}
      </Button>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {t("form.shortcut")}
        <KbdGroup>
          <Kbd>{t("form.keys.ctrl")}</Kbd>
          <Kbd>{t("form.keys.enter")}</Kbd>
        </KbdGroup>
      </p>
    </div>
  );
}

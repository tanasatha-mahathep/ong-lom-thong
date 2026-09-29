import { type ComponentProps, useId } from "react";
import { useTranslation } from "react-i18next";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { isoToThaiInput, parseDateField } from "@/lib/thai-date";
import { cn } from "@/lib/utils";

export type ThaiDateFieldProps = Omit<ComponentProps<typeof Input>, "type" | "placeholder" | "size"> & {
  label: string;
  /** error ใต้ช่อง (แปลแล้ว) */
  error?: string;
  /** ออกจากช่องแล้วอ่านวันที่ได้ แต่ข้อความยังไม่ใช่รูป วว/ดด/ปปปป พ.ศ. — ส่งข้อความที่จัดรูปแล้วกลับไปให้ผู้เรียกตั้งค่า */
  onFormat?: (text: string) => void;
};

/**
 * ช่องวันที่พิมพ์เอง พ.ศ. — `<input type="text">` ห้าม date picker / input mask (CLAUDE.md กฎ 6)
 * ป้ายอยู่เหนือช่อง · placeholder "วว/ดด/ปปปป" เห็นตลอด · คำแนะนำใต้ช่อง · error ใต้ช่อง (aria-describedby)
 * placeholder และคำแนะนำเป็นข้อความชุดเดียวทุกหน้า (common.dateField)
 * ออกจากช่อง: อ่านได้ = จัดรูปเป็น วว/ดด/ปปปป พ.ศ. (ไม่แทรกระหว่างพิมพ์) · อ่านไม่ได้ = คงที่พิมพ์ ให้ผู้เรียกแสดง error
 */
export function ThaiDateField({ id, label, error, onFormat, onBlur, className, ...props }: ThaiDateFieldProps) {
  const { t } = useTranslation("common");
  const autoId = useId();
  const fieldId = id ?? autoId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <Input
        autoComplete="off"
        spellCheck={false}
        {...props}
        id={fieldId}
        type="text"
        placeholder={t("dateField.placeholder")}
        aria-invalid={!!error}
        aria-describedby={error ? `${errorId} ${hintId}` : hintId}
        className={cn("tabular-nums", className)}
        onBlur={(event) => {
          const text = event.currentTarget.value;
          const parsed = parseDateField(text);
          if ("iso" in parsed) {
            const formatted = isoToThaiInput(parsed.iso);
            if (formatted !== text) onFormat?.(formatted);
          }
          onBlur?.(event);
        }}
      />
      <FieldDescription id={hintId}>{t("dateField.hint")}</FieldDescription>
      <FieldError id={errorId}>{error}</FieldError>
    </Field>
  );
}

import { type ComponentProps, useId } from "react";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";

export type LabeledSelectProps = Omit<ComponentProps<typeof NativeSelect>, "size"> & {
  label: string;
  /** error ใต้ช่อง (แปลแล้ว) */
  error?: string;
};

/**
 * native `<select>` ป้ายอยู่เหนือช่อง + error ใต้ช่อง — ไม่มีป๊อปอัปแย่งโฟกัส ใช้คีย์บอร์ดได้เอง
 * ตัวเลือกส่งเป็น children (`NativeSelectOption`) · ใช้กับตัวกรอง/ฟอร์มที่ไม่ใช่ Siam ID 11 ช่อง
 */
export function LabeledSelect({ id, label, error, children, ...props }: LabeledSelectProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const errorId = `${fieldId}-error`;
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <NativeSelect
        {...props}
        id={fieldId}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : props["aria-describedby"]}
      >
        {children}
      </NativeSelect>
      <FieldError id={errorId}>{error}</FieldError>
    </Field>
  );
}

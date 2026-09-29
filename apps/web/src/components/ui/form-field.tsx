import * as React from "react";
import { cn } from "cn";
import { FieldDescription, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

/**
 * ช่องกรอกมาตรฐานของทุกฟอร์ม (กฎ U0–U3) บน shadcn Label + Input / Textarea / NativeSelect
 *
 * - U0 ป้ายอยู่ **เหนือช่อง** ขนาดอ่านง่ายเสมอ (ไม่ลอย) · เป็น `<label for>` จริง · `required` = ดอกจันสีแดง
 *   (ประดับ `aria-hidden` — screen reader ได้ยินจาก `required` ของช่องแทน)
 * - U1 `placeholder` = ตัวอย่าง/รูปแบบ (`วว/ดด/ปปปป` · `081-234-5678`) **แสดงตลอด** · บังคับใน type
 *   (ไม่มีตัวอย่างที่มีความหมายจริง ๆ ส่ง `""`)
 * - U2/U3 `error` → ขอบแดง + `aria-invalid` + ข้อความใต้ช่องผูก `aria-describedby` · `description` = คำอธิบายใต้ช่อง
 *   (ต่อจาก `aria-describedby` ที่ส่งมาเอง)
 * - `size="compact"` = ช่องเตี้ยลง ระยะชิดขึ้น สำหรับหน้าซื้อเข้า (ป้ายยังขนาดปกติ)
 * - `TextField` ค่าเริ่มต้น `type="text"` — ช่องวันที่ของ Siam ID ไม่กลายเป็น date picker
 */

export type FieldSize = "default" | "compact";

interface FieldExtraProps {
  /** ป้ายของช่อง (ข้อความที่แปลแล้ว) */
  label: React.ReactNode;
  /** error ใต้ช่อง (แปลแล้ว) — มีค่า = ช่องผิด */
  error?: string;
  /** คำอธิบายใต้ช่อง */
  description?: React.ReactNode;
  size?: FieldSize;
  /** class ของกล่องนอกสุด (ป้าย + ช่อง + ข้อความใต้ช่อง) — `className` ไปที่ตัวช่อง */
  wrapperClassName?: string;
}

/** placeholder = ตัวอย่าง/รูปแบบ (U1) — บังคับ ให้ลืมไม่ได้ */
interface RequiredPlaceholder {
  placeholder: string;
}

const CONTROL = {
  default: "",
  compact: "h-8 px-2.5 text-sm md:text-sm",
} as const satisfies Record<FieldSize, string>;

const TEXTAREA = {
  default: "",
  compact: "min-h-14 px-2.5 py-1.5 text-sm md:text-sm",
} as const satisfies Record<FieldSize, string>;

const joinIds = (...ids: (string | false | null | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;

/** id ของช่อง + ข้อความใต้ช่อง และ props aria ที่รวมกับของผู้เรียก */
function useFieldAria(
  id: string | undefined,
  { error, description }: Pick<FieldExtraProps, "error" | "description">,
  props: { "aria-describedby"?: string; "aria-invalid"?: React.AriaAttributes["aria-invalid"] },
) {
  const autoId = React.useId();
  const controlId = id ?? autoId;
  const errorId = `${controlId}-error`;
  const descriptionId = `${controlId}-description`;
  const hasDescription = description !== undefined && description !== null && description !== "";
  return {
    controlId,
    errorId,
    descriptionId,
    hasDescription,
    aria: {
      "aria-invalid": error ? true : props["aria-invalid"],
      "aria-describedby": joinIds(props["aria-describedby"], hasDescription && descriptionId, error && errorId),
    },
  };
}

function FieldFrame({
  size,
  label,
  controlId,
  required,
  error,
  description,
  errorId,
  descriptionId,
  hasDescription,
  className,
  children,
}: {
  size: FieldSize;
  label: React.ReactNode;
  controlId: string;
  required?: boolean;
  error?: string;
  description?: React.ReactNode;
  errorId: string;
  descriptionId: string;
  hasDescription: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="form-field"
      data-size={size}
      data-invalid={error ? true : undefined}
      className={cn("group/form-field flex w-full min-w-0 flex-col", size === "compact" ? "gap-1" : "gap-2", className)}
    >
      {/* ดอกจันอยู่นอก <label> — ชื่อช่อง (และ getByLabelText ในเทสต์) เป็นข้อความป้ายล้วน */}
      <div className="flex items-baseline gap-1 group-has-[:disabled]/form-field:opacity-50">
        <Label htmlFor={controlId} className="leading-snug group-data-[invalid=true]/form-field:text-destructive">
          {label}
        </Label>
        {required && (
          <span aria-hidden="true" className="text-sm leading-none text-destructive">
            *
          </span>
        )}
      </div>
      <div className="relative">{children}</div>
      {hasDescription && (
        <FieldDescription id={descriptionId} className={size === "compact" ? "text-xs" : undefined}>
          {description}
        </FieldDescription>
      )}
      {error && (
        <FieldError id={errorId} className={size === "compact" ? "text-xs" : undefined}>
          {error}
        </FieldError>
      )}
    </div>
  );
}

export type TextFieldProps = Omit<React.ComponentProps<"input">, "size" | "placeholder"> &
  FieldExtraProps &
  RequiredPlaceholder & {
    /** ปุ่ม/ไอคอนท้ายช่อง (วางทับขอบขวาในช่อง) — ใส่แล้วเว้นขวาด้วย `className="pr-10"` */
    trailing?: React.ReactNode;
  };

/** ป้ายเหนือช่อง + input — ใช้แทน `Input` ในทุกฟอร์ม (ช่อง combobox: ส่ง `role="combobox"` + aria เอง) */
function TextField({
  id,
  label,
  error,
  description,
  size = "default",
  wrapperClassName,
  className,
  type = "text",
  trailing,
  ...props
}: TextFieldProps) {
  const f = useFieldAria(id, { error, description }, props);
  return (
    <FieldFrame
      size={size}
      label={label}
      required={props.required}
      error={error}
      description={description}
      className={wrapperClassName}
      {...f}
    >
      <Input
        {...props}
        {...f.aria}
        type={type}
        id={f.controlId}
        data-size={size}
        className={cn(CONTROL[size], className)}
      />
      {trailing}
    </FieldFrame>
  );
}

export type TextareaFieldProps = Omit<React.ComponentProps<"textarea">, "placeholder"> &
  FieldExtraProps &
  RequiredPlaceholder;

/** ป้ายเหนือช่อง + textarea (ที่อยู่ · หมายเหตุ) */
function TextareaField({
  id,
  label,
  error,
  description,
  size = "default",
  wrapperClassName,
  className,
  ...props
}: TextareaFieldProps) {
  const f = useFieldAria(id, { error, description }, props);
  return (
    <FieldFrame
      size={size}
      label={label}
      required={props.required}
      error={error}
      description={description}
      className={wrapperClassName}
      {...f}
    >
      <Textarea {...props} {...f.aria} id={f.controlId} data-size={size} className={cn(TEXTAREA[size], className)} />
    </FieldFrame>
  );
}

export type SelectFieldProps = Omit<React.ComponentProps<"select">, "size"> &
  FieldExtraProps & {
    /** ตัวเลือกแรกค่าว่าง (เช่น "— เลือก —") — ไม่ส่ง = ไม่มีตัวเลือกว่าง */
    placeholder?: string;
  };

/**
 * ป้ายเหนือช่อง + native `<select>` — ตัวเลือกใช้ `NativeSelectOption`
 * ห้ามใช้ในฟอร์ม Siam ID 11 ช่อง (CLAUDE.md กฎ 6)
 */
function SelectField({
  id,
  label,
  error,
  description,
  size = "default",
  wrapperClassName,
  className,
  placeholder,
  children,
  ...props
}: SelectFieldProps) {
  const f = useFieldAria(id, { error, description }, props);
  return (
    <FieldFrame
      size={size}
      label={label}
      required={props.required}
      error={error}
      description={description}
      className={wrapperClassName}
      {...f}
    >
      <NativeSelect
        {...props}
        {...f.aria}
        id={f.controlId}
        size={size === "compact" ? "sm" : "default"}
        className={className}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {children}
      </NativeSelect>
    </FieldFrame>
  );
}

export { SelectField, TextareaField, TextField };

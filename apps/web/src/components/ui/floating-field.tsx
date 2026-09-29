import * as React from "react";
import { cn } from "cn";
import { FieldDescription, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

/**
 * floating label แบบ Bootstrap `.form-floating` บน shadcn Input / Textarea / NativeSelect (ฟอร์มกฎ U0–U1)
 *
 * - ป้ายเป็น `<label for>` จริง วางใน DOM **หลัง** ช่อง (Tailwind `peer`) แต่แสดงทับอยู่ในช่อง
 *   ช่องว่าง = ป้ายอยู่กลางช่อง · โฟกัส/มีค่า/autofill = ป้ายลอยขึ้นขอบบน (variant `floated:` ใน styles.css)
 * - placeholder = ตัวอย่าง/รูปแบบ (`วว/ดด/ปปปป` · `081-234-5678`) โปร่งใสระหว่างที่ป้ายทับช่อง เห็นเมื่อโฟกัส
 *   ไม่ส่ง placeholder ก็ได้ (ใช้ช่องว่างแทน — `:placeholder-shown` ต้องมี placeholder เสมอ)
 * - คีย์บอร์ด/โฟกัสเหมือนช่องธรรมดา (ป้าย `pointer-events-none` คลิกทะลุไปที่ช่อง)
 * - `error` → ขอบแดง + `aria-invalid` + ข้อความใต้ช่องผูก `aria-describedby` · `description` = คำอธิบายใต้ช่อง
 * - `size="compact"` = ความสูงน้อยลงสำหรับหน้าซื้อเข้า (ฟอร์มยาว หน้าจอเดียว)
 */

export type FloatingSize = "default" | "compact";

interface FloatingExtraProps {
  /** ป้ายของช่อง (ข้อความที่แปลแล้ว) */
  label: React.ReactNode;
  /** error ใต้ช่อง (แปลแล้ว) — มีค่า = ช่องผิด */
  error?: string;
  /** คำอธิบายใต้ช่อง */
  description?: React.ReactNode;
  size?: FloatingSize;
  /** class ของกล่องนอกสุด (ช่อง + ข้อความใต้ช่อง) — `className` ไปที่ตัวช่อง */
  wrapperClassName?: string;
}

const CONTROL = {
  default: "h-14 py-0 pt-6 pb-1.5 text-base md:text-sm",
  compact: "h-11 py-0 pt-4 pb-0.5 text-sm",
} as const satisfies Record<FloatingSize, string>;

const TEXTAREA = {
  default: "min-h-20 pt-7 pb-2",
  compact: "min-h-16 pt-5 pb-1.5 text-sm",
} as const satisfies Record<FloatingSize, string>;

/** placeholder โปร่งใสจนกว่าช่องได้โฟกัส (ป้ายลอยขึ้นแล้ว) */
const PEER = "peer placeholder:text-transparent focus:placeholder:text-muted-foreground";

const LABEL_BASE =
  "pointer-events-none absolute right-3 left-3 truncate text-left leading-normal text-muted-foreground select-none motion-safe:transition-all motion-safe:duration-150 group-has-[:disabled]/floating:opacity-50 group-data-[invalid=true]/floating:text-destructive peer-aria-invalid:text-destructive";

/** ป้ายของ input: กลางช่อง → ขอบบน */
const INPUT_LABEL = {
  default: "top-1/2 -translate-y-1/2 text-base md:text-sm floated:top-1.5 floated:translate-y-0 floated:text-xs",
  compact: "top-1/2 -translate-y-1/2 text-sm floated:top-0.5 floated:translate-y-0 floated:text-[0.6875rem]",
} as const satisfies Record<FloatingSize, string>;

/** ป้ายของ textarea: บรรทัดแรก → ขอบบน */
const TEXTAREA_LABEL = {
  default: "top-2.5 text-base md:text-sm floated:top-1.5 floated:text-xs",
  compact: "top-2 text-sm floated:top-0.5 floated:text-[0.6875rem]",
} as const satisfies Record<FloatingSize, string>;

/** ป้ายของ select: select มีค่าที่เลือกแสดงอยู่เสมอ → ลอยตลอด (เหมือน Bootstrap) */
const SELECT_LABEL = {
  default: "top-1.5 text-xs",
  compact: "top-0.5 text-[0.6875rem]",
} as const satisfies Record<FloatingSize, string>;

const joinIds = (...ids: (string | false | null | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;

/** id ของช่อง + ข้อความใต้ช่อง และ props aria ที่ต้องรวมกับของผู้เรียก */
function useFloatingAria(
  id: string | undefined,
  { error, description }: Pick<FloatingExtraProps, "error" | "description">,
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

function FloatingFrame({
  size,
  error,
  description,
  errorId,
  descriptionId,
  hasDescription,
  className,
  children,
}: {
  size: FloatingSize;
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
      data-slot="floating-field"
      data-size={size}
      data-invalid={error ? true : undefined}
      className={cn("group/floating flex w-full min-w-0 flex-col gap-1.5", className)}
    >
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

export type FloatingInputProps = Omit<React.ComponentProps<"input">, "size"> & FloatingExtraProps;

/** input + floating label — ใช้แทน `Input` ในทุกฟอร์ม (รวมช่องแบบ combobox: ส่ง `role="combobox"` + aria เอง) */
function FloatingInput({
  id,
  label,
  error,
  description,
  size = "default",
  wrapperClassName,
  className,
  placeholder,
  type = "text",
  ...props
}: FloatingInputProps) {
  const f = useFloatingAria(id, { error, description }, props);
  return (
    <FloatingFrame size={size} error={error} description={description} className={wrapperClassName} {...f}>
      <Input
        {...props}
        {...f.aria}
        type={type}
        id={f.controlId}
        placeholder={placeholder || " "}
        data-size={size}
        className={cn(CONTROL[size], PEER, className)}
      />
      <label htmlFor={f.controlId} data-slot="floating-label" className={cn(LABEL_BASE, INPUT_LABEL[size])}>
        {label}
      </label>
    </FloatingFrame>
  );
}

export type FloatingTextareaProps = React.ComponentProps<"textarea"> & FloatingExtraProps;

/** textarea + floating label (ที่อยู่ · หมายเหตุ) */
function FloatingTextarea({
  id,
  label,
  error,
  description,
  size = "default",
  wrapperClassName,
  className,
  placeholder,
  ...props
}: FloatingTextareaProps) {
  const f = useFloatingAria(id, { error, description }, props);
  return (
    <FloatingFrame size={size} error={error} description={description} className={wrapperClassName} {...f}>
      <Textarea
        {...props}
        {...f.aria}
        id={f.controlId}
        placeholder={placeholder || " "}
        data-size={size}
        className={cn(TEXTAREA[size], PEER, className)}
      />
      <label htmlFor={f.controlId} data-slot="floating-label" className={cn(LABEL_BASE, TEXTAREA_LABEL[size])}>
        {label}
      </label>
    </FloatingFrame>
  );
}

export type FloatingSelectProps = Omit<React.ComponentProps<"select">, "size"> &
  FloatingExtraProps & {
    /** ตัวเลือกแรกค่าว่าง (เช่น "— เลือก —") — ไม่ส่ง = ไม่มีตัวเลือกว่าง */
    placeholder?: string;
  };

/**
 * native `<select>` + floating label (ป้ายลอยตลอด) — ใช้ `NativeSelectOption` เป็นตัวเลือก
 * ห้ามใช้ในฟอร์ม Siam ID 11 ช่อง (CLAUDE.md กฎ 6)
 */
function FloatingSelect({
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
}: FloatingSelectProps) {
  const f = useFloatingAria(id, { error, description }, props);
  return (
    <FloatingFrame size={size} error={error} description={description} className={wrapperClassName} {...f}>
      <NativeSelect {...props} {...f.aria} id={f.controlId} className={cn(CONTROL[size], className)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {children}
      </NativeSelect>
      <label htmlFor={f.controlId} data-slot="floating-label" className={cn(LABEL_BASE, "pr-6", SELECT_LABEL[size])}>
        {label}
      </label>
    </FloatingFrame>
  );
}

export { FloatingInput, FloatingSelect, FloatingTextarea };

import * as React from "react";
import { cn } from "cn";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FieldDescription, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { APP_FORM_SUBMIT_EVENT } from "@/lib/form-events";

/**
 * ช่องกรอกมาตรฐานของทุกฟอร์ม (กฎ U0–U3 · U7) บน shadcn Label + Input / Textarea / NativeSelect
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

/** ปุ่มลัดแสดง/ซ่อนรหัสผ่านจากในช่อง (ตรงกับปุ่มแสดงรหัสผ่านของ Edge บน Windows) */
export const PASSWORD_TOGGLE_SHORTCUT = "Alt+F8";

export type PasswordFieldProps = Omit<TextFieldProps, "type" | "trailing">;

/**
 * ช่องรหัสผ่าน + ปุ่มรูปตา แสดง/ซ่อน (U7) — ใช้กับรหัสผ่านทุกช่อง แทน `type="password"`
 *
 * - ปุ่มเป็น toggle: `aria-pressed` บอกสถานะ · ชื่อปุ่มคงที่ "แสดงรหัสผ่าน" (WAI-ARIA APG: ปุ่มที่ใช้ aria-pressed
 *   ห้ามเปลี่ยนชื่อ — "ซ่อนรหัสผ่าน, กดอยู่" ฟังแล้วกลับความหมาย) · tooltip (`title`) บอกการกระทำถัดไป + ปุ่มลัด
 * - ปุ่มไม่อยู่ในลำดับ Tab (`tabIndex=-1`) — Tab จากช่องไปช่องถัดไปตรง ๆ (ฟอร์มหน้าร้านใช้ Tab ไล่ช่อง)
 *   คีย์บอร์ดสลับด้วย Alt+F8 ขณะอยู่ในช่อง (`aria-keyshortcuts` ที่ช่อง) · เมาส์/นิ้วกดปุ่มได้ตามปกติ
 * - สลับแล้วโฟกัสและตำแหน่งเคอร์เซอร์อยู่ในช่องเดิม · ข้อความไม่ลอดใต้ไอคอน (เว้นขวา)
 * - `autoComplete` (current-password / new-password) ส่งผ่านตามเดิม — password manager ใช้ได้
 * - กลับเป็นซ่อนทุกครั้งที่ฟอร์ม (`useAppForm`) เริ่มส่ง — รวมหลังบันทึกสำเร็จ — และเมื่อช่องถูกล้างเป็นค่าว่าง
 */
function PasswordField({ id, ref, onKeyDown, className, value, ...props }: PasswordFieldProps) {
  const { t } = useTranslation("common");
  const autoId = React.useId();
  const controlId = id ?? autoId;
  const [visible, setVisible] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const selection = React.useRef<[number | null, number | null] | null>(null);

  const setRefs = React.useCallback(
    (element: HTMLInputElement | null) => {
      inputRef.current = element;
      if (typeof ref === "function") ref(element);
      else if (ref) ref.current = element;
    },
    [ref],
  );

  const toggle = () => {
    const input = inputRef.current;
    selection.current = input ? [input.selectionStart, input.selectionEnd] : null;
    setVisible((v) => !v);
  };

  // เปลี่ยน type แล้ว browser บางตัวย้ายเคอร์เซอร์ไปต้นช่อง — คืนโฟกัส + ตำแหน่งเดิม
  React.useLayoutEffect(() => {
    const input = inputRef.current;
    const saved = selection.current;
    if (!input || !saved) return;
    selection.current = null;
    input.focus();
    const [start, end] = saved;
    if (start !== null && end !== null) input.setSelectionRange(start, end);
  }, [visible]);

  // ฟอร์มเริ่มส่ง = ซ่อนกลับ (หลังบันทึกสำเร็จ รหัสผ่านไม่ค้างบนจอ)
  React.useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const hide = () => setVisible(false);
    form.addEventListener(APP_FORM_SUBMIT_EVENT, hide);
    return () => form.removeEventListener(APP_FORM_SUBMIT_EVENT, hide);
  }, []);

  // ช่องถูกล้าง (reset ฟอร์ม) = ซ่อนกลับ
  const [lastValue, setLastValue] = React.useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (value === "" && visible) setVisible(false);
  }

  return (
    <TextField
      {...props}
      id={controlId}
      value={value}
      ref={setRefs}
      type={visible ? "text" : "password"}
      aria-keyshortcuts={PASSWORD_TOGGLE_SHORTCUT}
      // แสดงเป็นข้อความแล้วไม่ส่งไปตรวจคำ/แก้ตัวพิมพ์
      spellCheck={false}
      autoCapitalize="off"
      className={cn("pr-10", className)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.altKey && event.key === "F8") {
          event.preventDefault();
          toggle();
        }
      }}
      trailing={
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("password.show")}
          aria-pressed={visible}
          aria-controls={controlId}
          title={t("password.hint", {
            action: visible ? t("password.hide") : t("password.show"),
            shortcut: PASSWORD_TOGGLE_SHORTCUT,
          })}
          data-slot="password-toggle"
          // เมาส์กดแล้วโฟกัสไม่ออกจากช่อง
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggle}
          className="absolute top-1/2 right-1 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
        >
          {visible ? (
            <EyeOffIcon className="size-4" aria-hidden="true" />
          ) : (
            <EyeIcon className="size-4" aria-hidden="true" />
          )}
        </button>
      }
    />
  );
}

export { PasswordField, SelectField, TextareaField, TextField };

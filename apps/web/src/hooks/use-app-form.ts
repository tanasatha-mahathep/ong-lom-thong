import { type DeepKeys, type ValidationLogicFn, defaultValidationLogic, useForm, useStore } from "@tanstack/react-form";
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { z } from "zod";
import { ApiError, errorMessage as defaultErrorMessage } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/notify";

/**
 * ฟอร์มมาตรฐานของแอป (กฎ U2–U5) บน TanStack Form + zod — หน้าเขียนแค่ schema · ช่อง · ฟังก์ชันส่ง
 *
 * - U2 ตรวจก่อนส่ง: schema รันทุกครั้งที่พิมพ์/ออกจากช่อง แต่ error แสดงเมื่อออกจากช่องนั้นแล้ว (blur ครั้งแรก)
 *   หลังจากนั้นอัปเดตทุกครั้งที่พิมพ์ · กดบันทึกทั้งที่ผิด = แสดง error ทุกช่อง + โฟกัสช่องแรกที่ผิด (ตามลำดับ DOM)
 * - U3 ตรวจหลังส่ง: `ApiError.field` ของ API (`{error, field}`) → error ใต้ช่องนั้น + โฟกัสช่อง · ทุก error มี toast
 *   error ของ API หายเมื่อแก้ช่องนั้น
 * - U4 ระหว่างส่ง: `submitting` = true → `<AppForm>` ปิดทั้งฟอร์ม (`<fieldset disabled>`) · `<SubmitButton>` หมุน
 *   ส่งซ้ำไม่ได้ (กันทั้ง Enter · Ctrl+Enter · ดับเบิลคลิก)
 * - U5 หลังส่ง: `successMessage` → toast สำเร็จ (หายเอง) · error → toast ค้างจนปิด (lib/notify.ts)
 *
 * เงิน: ห้ามคำนวณใน `submit` หรือ schema — ส่งข้อความที่ผู้ใช้พิมพ์ให้ API ตัดสิน (CLAUDE.md กฎ 2)
 */
export interface UseAppFormOptions<TValues extends object, TResult> {
  defaultValues: TValues;
  /** zod schema ของค่าในฟอร์ม — ข้อความ error เป็นข้อความที่แปลแล้ว (สร้าง schema ใน `useMemo` ด้วย `t`) */
  schema?: z.ZodType<unknown, TValues>;
  /** ส่งไป API — throw `ApiError` เมื่อไม่สำเร็จ */
  submit: (values: TValues) => Promise<TResult>;
  /** หลังสำเร็จ (ฟอร์มยังปิดอยู่ระหว่างรอ) — เช่น `blockingNavigate(...)` ไปหน้าถัดไป */
  onSuccess?: (result: TResult, values: TValues) => void | Promise<void>;
  /** toast สำเร็จ — ไม่ส่ง / คืน undefined = ไม่มี toast */
  successMessage?: string | ((result: TResult, values: TValues) => string | undefined);
  /** ข้อความของ error — ค่าเริ่มต้น `errorMessage()` ของ lib/api (ข้อความไทยของ API หรือคำแปลตาม status) */
  errorMessage?: (error: unknown) => string;
  /**
   * ช่องที่ error ชี้ — ค่าเริ่มต้น `ApiError.field` (ตัด `.index` ออก) ถ้าเป็นช่องของฟอร์มนี้
   * คืน undefined = error ของทั้งฟอร์ม (toast + `formError`)
   */
  fieldOfError?: (error: unknown) => string | undefined;
  /** error ที่ไม่ชี้ช่อง → โฟกัสช่องนี้แทนปุ่มบันทึก (เช่น login ผิด → ช่องรหัสผ่าน) */
  focusOnFormError?: string;
}

/** ส่วนที่ `<AppForm>` / `<SubmitButton>` ใช้ */
export interface AppFormControls {
  submitting: boolean;
  formProps: {
    ref: (element: HTMLFormElement | null) => void;
    noValidate: true;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLFormElement>) => void;
  };
  /** callback ref ของปุ่มบันทึก (โฟกัสกลับเมื่อ error ไม่ชี้ช่อง) */
  submitButton: (element: HTMLButtonElement | null) => void;
}

/** props ที่ `bind(field)` คืน — ส่งต่อให้ FloatingInput / FloatingTextarea / FloatingSelect ได้ตรง ๆ */
export interface BoundFieldProps {
  id: string;
  name: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  onBlur: () => void;
  error: string | undefined;
}

/** ส่วนของ TanStack FieldApi ที่ `bind` ใช้ — ช่องที่ค่าเป็นข้อความ */
export interface TextFieldApi {
  name: string;
  state: { value: string; meta: { isBlurred: boolean; errors: readonly unknown[] } };
  handleChange: (value: string) => void;
  handleBlur: () => void;
}

/**
 * schema (validator `onChange` ของฟอร์ม) รันทั้งตอนพิมพ์ · ออกจากช่อง · ส่ง — error อยู่ช่องเดียว (errorMap.onChange)
 * จึงไม่ค้างของเก่าเมื่อแก้แล้ว · การ "แสดง" error คุมด้วย isBlurred / submissionAttempts ใน `errorOf`
 */
const everyEvent: ValidationLogicFn = (props) =>
  defaultValidationLogic(props.event.type === "blur" ? { ...props, event: { ...props.event, type: "change" } } : props);

/** error ของ TanStack Form: issue ของ Standard Schema `{message}` · ข้อความ · array ซ้อน */
function firstMessage(errors: readonly unknown[]): string | undefined {
  for (const error of errors) {
    if (typeof error === "string" && error) return error;
    if (Array.isArray(error)) {
      const nested = firstMessage(error);
      if (nested) return nested;
    }
    if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
      return error.message;
    }
  }
  return undefined;
}

const defaultFieldOfError = (error: unknown) => (error instanceof ApiError ? error.field?.split(".")[0] : undefined);

type FocusTarget = { kind: "field"; name: string } | { kind: "firstInvalid"; names: string[] } | { kind: "submit" };

export function useAppForm<TValues extends object, TResult = unknown>(options: UseAppFormOptions<TValues, TResult>) {
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const setFormElement = useCallback((element: HTMLFormElement | null) => {
    formRef.current = element;
  }, []);
  const setSubmitButton = useCallback((element: HTMLButtonElement | null) => {
    submitRef.current = element;
  }, []);
  const busy = useRef(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<string, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // โฟกัสที่รอทำหลัง render ถัดไป — ตอน error เกิด fieldset ยังปิดอยู่ (โฟกัสช่องที่ disabled ไม่ได้)
  const pendingFocus = useRef<FocusTarget | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const requestFocus = useCallback((target: FocusTarget) => {
    pendingFocus.current = target;
    setFocusTick((n) => n + 1);
  }, []);
  // ค่าล่าสุดของ options โดยไม่ต้องสร้าง useForm ใหม่ (callback ของหน้ามักสร้างใหม่ทุก render)
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  const fieldId = useCallback((name: string) => `${formId}-${name}`, [formId]);

  const form = useForm({
    defaultValues: options.defaultValues,
    validationLogic: everyEvent,
    validators: options.schema ? { onChange: options.schema } : undefined,
    // ตรวจใหม่ทุกครั้งที่กดบันทึก (ไม่เงียบเพราะ error ค้าง)
    canSubmitWhenInvalid: true,
    onSubmitInvalid: ({ formApi }) => {
      const names = Object.keys(formApi.state.fieldMeta).filter((name) =>
        firstMessage(formApi.getFieldMeta(name as DeepKeys<TValues>)?.errors ?? []),
      );
      requestFocus({ kind: "firstInvalid", names });
    },
    onSubmit: async ({ value }) => {
      const opts = latest.current;
      setFormError(null);
      setServerErrors({});
      try {
        const result = await opts.submit(value);
        const success =
          typeof opts.successMessage === "function" ? opts.successMessage(result, value) : opts.successMessage;
        if (success) notifySuccess(success);
        await opts.onSuccess?.(result, value);
      } catch (error) {
        const message = (opts.errorMessage ?? defaultErrorMessage)(error);
        const pointed = (opts.fieldOfError ?? defaultFieldOfError)(error);
        const field = pointed !== undefined && pointed in value ? pointed : undefined;
        notifyError(message);
        if (field) {
          setServerErrors({ [field]: message });
          requestFocus({ kind: "field", name: field });
        } else {
          setFormError(message);
          requestFocus(opts.focusOnFormError ? { kind: "field", name: opts.focusOnFormError } : { kind: "submit" });
        }
      }
    },
  });

  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
  const submissionAttempts = useStore(form.store, (state) => state.submissionAttempts);
  const submitting = isSubmitting;

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || submitting) return;
    pendingFocus.current = null;
    if (target.kind === "submit") {
      submitRef.current?.focus();
      return;
    }
    const invalid = new Set(target.kind === "field" ? [] : target.names);
    const element =
      target.kind === "field"
        ? document.getElementById(fieldId(target.name))
        : [...(formRef.current?.elements ?? [])].find(
            (el): el is HTMLElement => el instanceof HTMLElement && invalid.has(el.getAttribute("name") ?? ""),
          );
    element?.focus();
    if (element instanceof HTMLInputElement && target.kind === "field") element.select();
  }, [focusTick, submitting, fieldId]);

  const submit = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    // จบเมื่อ submit + onSuccess เสร็จ (รวมรอนำทาง) — ระหว่างนั้น Enter / Ctrl+Enter / คลิกซ้ำไม่มีผล
    void form.handleSubmit().finally(() => {
      busy.current = false;
    });
  }, [form]);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      submit();
    },
    [submit],
  );

  // Ctrl+Enter (⌘+Enter) = บันทึก จากช่องไหนก็ได้ (สเปก §3.1)
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLFormElement>) => {
      if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.nativeEvent.isComposing) return;
      event.preventDefault();
      submit();
    },
    [submit],
  );

  /** error ที่แสดงของช่อง: ของ API ก่อน · ของ schema เมื่อออกจากช่องแล้ว หรือเคยกดบันทึก */
  const errorOf = (field: Pick<TextFieldApi, "name" | "state">): string | undefined => {
    const server = serverErrors[field.name];
    if (server) return server;
    const visible = field.state.meta.isBlurred || submissionAttempts > 0;
    return visible ? firstMessage(field.state.meta.errors) : undefined;
  };

  const clearServerError = (name: string) => {
    if (serverErrors[name]) setServerErrors(({ [name]: _removed, ...rest }) => rest);
  };

  /** props ของช่องข้อความ — `<FloatingInput label=… placeholder=… {...bind(field)} />` */
  const bind = (field: TextFieldApi): BoundFieldProps => ({
    id: fieldId(field.name),
    name: field.name,
    value: field.state.value,
    onChange: (event) => {
      field.handleChange(event.target.value);
      clearServerError(field.name);
    },
    onBlur: field.handleBlur,
    error: errorOf(field),
  });

  /** ตั้ง error ของ API ให้ช่องเอง (กรณีที่ไม่ได้มาจาก `submit`) */
  const setFieldError = (name: string, message: string | undefined) =>
    setServerErrors((prev) => ({ ...prev, [name]: message }));

  const controls: AppFormControls = {
    submitting,
    formProps: { ref: setFormElement, noValidate: true, onSubmit, onKeyDown },
    submitButton: setSubmitButton,
  };

  return {
    ...controls,
    /** TanStack FormApi — `form.Field` · `form.Subscribe` · `form.setFieldValue` */
    form,
    /** error ที่ไม่ชี้ช่อง (แสดงใน toast แล้ว) — หน้าอยากแสดงในฟอร์มด้วยก็ใช้ค่านี้ */
    formError,
    bind,
    errorOf,
    fieldId,
    setFieldError,
    clearServerError,
    /** ส่งฟอร์มด้วยโปรแกรม (ปุ่มนอก `<form>`) */
    submit,
  };
}

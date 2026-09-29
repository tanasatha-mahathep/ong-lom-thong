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
import { toast } from "sonner";
import type { z } from "zod";
import i18next from "@/i18n";
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
 *   toast ของฟอร์มหนึ่งใช้ id เดียว — ส่งซ้ำแล้วพังซ้ำไม่กองกัน · เริ่มส่งใหม่/สำเร็จ = toast error เดิมหาย
 * - `submit` ได้ค่าที่ผ่าน `schema.parse` แล้ว (trim · pipe · transform) ไม่ใช่ข้อความดิบในช่อง
 * - บันทึกสำเร็จแต่ `onSuccess` ล้ม (นำทาง/พิมพ์ไม่ได้) = **ไม่ใช่บันทึกไม่สำเร็จ** — ฟอร์มล็อกค้าง (`saved`)
 *   กันพนักงานกดบันทึกซ้ำจนได้บิลซ้ำ · toast บอกให้รีเฟรช · `reset()` ปลดล็อกพร้อมล้างค่า
 *
 * เงิน: ห้ามคำนวณใน `submit` หรือ schema — ส่งข้อความที่ผู้ใช้พิมพ์ให้ API ตัดสิน (CLAUDE.md กฎ 2)
 */
export interface UseAppFormOptions<TValues extends object, TParsed, TResult> {
  defaultValues: TValues;
  /**
   * zod schema ของค่าในฟอร์ม — ข้อความ error เป็นข้อความที่แปลแล้ว (สร้าง schema ใน `useMemo` ด้วย `t`)
   * input = ค่าในช่อง (`TValues`) · output = ค่าที่ `submit` ได้รับ · refine ที่ไม่มี `path` = error ของทั้งฟอร์ม
   */
  schema?: z.ZodType<TParsed, TValues>;
  /** ส่งไป API ด้วยค่าที่ parse แล้ว — throw `ApiError` เมื่อไม่สำเร็จ */
  submit: (values: TParsed) => Promise<TResult>;
  /**
   * หลังบันทึกสำเร็จ (ฟอร์มยังปิดอยู่ระหว่างรอ) — เช่น `blockingNavigate(...)` ไปหน้าถัดไป
   * throw ในนี้ไม่ทำให้นับเป็นบันทึกไม่สำเร็จ: ฟอร์มล็อกค้าง + toast `common.afterSaveFailed`
   */
  onSuccess?: (result: TResult, values: TParsed) => void | Promise<void>;
  /** toast สำเร็จ — ไม่ส่ง / คืน undefined = ไม่มี toast */
  successMessage?: string | ((result: TResult, values: TParsed) => string | undefined);
  /** ข้อความของ error — ค่าเริ่มต้น `errorMessage()` ของ lib/api (ข้อความไทยของ API หรือคำแปลตาม status) */
  errorMessage?: (error: unknown) => string;
  /**
   * path ของช่องที่ error ชี้ — ค่าเริ่มต้น `ApiError.field` · path แบบ API (`lines.1.weight_g`) แปลงเป็นชื่อช่อง
   * TanStack (`lines[1].weight_g`) ให้เอง · ไม่มีช่องนั้นในฟอร์ม = ลองช่องแม่ (`allowed_branch_ids.1` →
   * `allowed_branch_ids`) · ยังไม่เจอ / คืน undefined = error ของทั้งฟอร์ม (toast + `formError` + โฟกัสปุ่มบันทึก)
   */
  fieldOfError?: (error: unknown) => string | undefined;
  /** error ที่ไม่ชี้ช่อง → โฟกัสช่องนี้แทนปุ่มบันทึก (เช่น login ผิด → ช่องรหัสผ่าน) */
  focusOnFormError?: string;
  /**
   * false = Enter ในช่อง input ไม่ส่งฟอร์ม (ฟอร์ม Siam ID — เครื่องอ่านบัตรส่ง Enter ท้ายข้อมูล) · บันทึกด้วยปุ่ม
   * หรือ Ctrl+Enter เท่านั้น · ค่าเริ่มต้น true (Enter ส่งฟอร์มตามปกติของ browser)
   */
  submitOnEnter?: boolean;
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

/** error ของทั้งฟอร์มจาก schema (refine ที่ไม่มี path) — TanStack เก็บไว้ใต้ key "" */
function formLevelMessage(errors: readonly unknown[]): string | undefined {
  for (const error of errors) {
    if (typeof error === "string" && error) return error;
    if (typeof error === "object" && error !== null && "" in error) {
      const bucket: unknown = (error as Record<string, unknown>)[""];
      if (Array.isArray(bucket)) {
        const message = firstMessage(bucket);
        if (message) return message;
      }
    }
  }
  return undefined;
}

const defaultFieldOfError = (error: unknown) => (error instanceof ApiError ? error.field : undefined);

/** path ของ API (`lines.1.weight_g`) → ชื่อช่องของ TanStack (`lines[1].weight_g`) */
export function toFieldName(path: string): string {
  return path
    .split(".")
    .filter(Boolean)
    .reduce(
      (name, segment) => (/^\d+$/.test(segment) ? `${name}[${segment}]` : name ? `${name}.${segment}` : segment),
      "",
    );
}

/** ชื่อช่องที่เป็นไปได้ ยาวสุดก่อน: `a[1].b` → `a[1]` → `a` */
function candidateNames(path: string): string[] {
  const name = toFieldName(path);
  const names = [name];
  for (let cut = name.length - 1; cut > 0; cut--) {
    const char = name[cut];
    if (char === "." || char === "[") names.push(name.slice(0, cut));
  }
  return names;
}

type FocusTarget = { kind: "field"; name: string } | { kind: "firstInvalid"; names: string[] } | { kind: "submit" };

export function useAppForm<TValues extends object, TParsed = TValues, TResult = unknown>(
  options: UseAppFormOptions<TValues, TParsed, TResult>,
) {
  const formId = useId();
  /** toast ของฟอร์มนี้ใช้ id เดียว — ซ้ำแล้วแทนที่ ไม่กอง */
  const toastId = `form-${formId}`;
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
  // บันทึกสำเร็จแล้วแต่ onSuccess ล้ม — ล็อกฟอร์มไว้ กันบันทึกซ้ำ
  const [saved, setSaved] = useState(false);
  const savedRef = useRef(false);
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
      // key "" = error ของทั้งฟอร์มที่ TanStack กระจายมาเป็น fieldMeta ด้วย — ไม่ใช่ช่อง
      const names = Object.keys(formApi.state.fieldMeta).filter(
        (name) => name !== "" && firstMessage(formApi.getFieldMeta(name as DeepKeys<TValues>)?.errors ?? []),
      );
      // refine ของทั้งฟอร์ม (ไม่ชี้ช่อง) ไม่มีช่องให้แสดง — ข้อความรวม + toast
      const formMessage = formLevelMessage(formApi.state.errors);
      setFormError(formMessage ?? null);
      if (formMessage) notifyError(formMessage, { id: toastId });
      requestFocus(names.length > 0 ? { kind: "firstInvalid", names } : { kind: "submit" });
    },
    onSubmit: async ({ value }) => {
      const opts = latest.current;
      setFormError(null);
      setServerErrors({});
      toast.dismiss(toastId);

      let values: TParsed;
      let result: TResult;
      try {
        // ผ่านการตรวจแล้ว — parse เพื่อได้ค่าที่แปลงแล้ว (trim · pipe) ไม่ใช่ตรวจซ้ำ
        values = opts.schema ? opts.schema.parse(value) : (value as unknown as TParsed);
        result = await opts.submit(values);
      } catch (error) {
        const message = (opts.errorMessage ?? defaultErrorMessage)(error);
        const pointed = (opts.fieldOfError ?? defaultFieldOfError)(error);
        const field = pointed ? findField(pointed) : undefined;
        notifyError(message, { id: toastId });
        if (field) {
          setServerErrors({ [field]: message });
          requestFocus({ kind: "field", name: field });
        } else {
          setFormError(message);
          requestFocus(opts.focusOnFormError ? { kind: "field", name: opts.focusOnFormError } : { kind: "submit" });
        }
        return;
      }

      // บันทึกแล้ว — จากนี้ห้ามนับเป็นบันทึกไม่สำเร็จ (ฟอร์มเปิดให้แก้ = บันทึกซ้ำได้ = บิลซ้ำ)
      const success =
        typeof opts.successMessage === "function" ? opts.successMessage(result, values) : opts.successMessage;
      if (success) notifySuccess(success, { id: toastId });
      try {
        await opts.onSuccess?.(result, values);
      } catch {
        savedRef.current = true;
        setSaved(true);
        notifyError(i18next.t("afterSaveFailed", { ns: "common" }), { id: toastId });
      }
    },
  });

  /** ชื่อช่องของ TanStack ที่มีอยู่จริงในฟอร์ม (mount แล้ว หรือมี element ชื่อนั้น) สำหรับ path ของ API */
  function findField(path: string): string | undefined {
    const mounted = new Set(Object.keys(form.state.fieldMeta));
    const named = new Set(
      [...(formRef.current?.elements ?? [])].map((el) => el.getAttribute("name")).filter((n): n is string => !!n),
    );
    return candidateNames(path).find((name) => mounted.has(name) || named.has(name));
  }

  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
  const submissionAttempts = useStore(form.store, (state) => state.submissionAttempts);
  /** ปิดฟอร์ม: ระหว่างส่ง หรือบันทึกแล้วแต่ไปต่อไม่ได้ */
  const submitting = isSubmitting || saved;

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || submitting) return;
    pendingFocus.current = null;
    if (target.kind === "submit") {
      submitRef.current?.focus();
      return;
    }
    const wanted = new Set(target.kind === "field" ? [target.name] : target.names);
    const byName = [...(formRef.current?.elements ?? [])].find((el): el is HTMLElement => {
      const elementName = el.getAttribute("name");
      return el instanceof HTMLElement && !!elementName && wanted.has(elementName);
    });
    // ช่องที่ใช้ bind() มี id ของเรา · ช่องอื่นหาจาก name · ไม่เจอเลย = ปุ่มบันทึก (โฟกัสไม่หลุดไป body)
    const element =
      (target.kind === "field" ? document.getElementById(fieldId(target.name)) : null) ?? byName ?? submitRef.current;
    element?.focus();
    if (element instanceof HTMLInputElement && target.kind === "field") element.select();
  }, [focusTick, submitting, fieldId]);

  const submit = useCallback(() => {
    if (busy.current || savedRef.current) return;
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

  // Ctrl+Enter (⌘+Enter) = บันทึก จากช่องไหนก็ได้ (สเปก §3.1) · submitOnEnter=false: Enter ธรรมดาในช่อง input ไม่ส่ง
  const submitOnEnter = options.submitOnEnter ?? true;
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLFormElement>) => {
      if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        submit();
      } else if (!submitOnEnter && event.target instanceof HTMLInputElement) {
        event.preventDefault();
      }
    },
    [submit, submitOnEnter],
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

  /** ปลดล็อกหลัง "บันทึกแล้วแต่ไปต่อไม่ได้" พร้อมล้างค่าเป็นค่าเริ่มต้น (เริ่มรายการใหม่) */
  const reset = () => {
    savedRef.current = false;
    setSaved(false);
    setServerErrors({});
    setFormError(null);
    form.reset();
  };

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
    /** บันทึกสำเร็จแล้วแต่ `onSuccess` ล้ม — ฟอร์มล็อกอยู่ (ปลดด้วย `reset()`) */
    saved,
    reset,
    bind,
    errorOf,
    fieldId,
    setFieldError,
    clearServerError,
    /** ส่งฟอร์มด้วยโปรแกรม (ปุ่มนอก `<form>`) */
    submit,
  };
}

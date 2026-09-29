import { isValidNationalId } from "@ong/core";
import { useForm, useStore } from "@tanstack/react-form";
import { CircleAlert, CircleCheck, Eraser, LoaderCircle, TriangleAlert } from "lucide-react";
import {
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { useBusinessDate } from "@/hooks/use-business-date";
import { cn } from "@/lib/utils";
import { expiryPreview } from "./card";
import { type ServerError, mapServerError } from "./errors";
import {
  CARD_FIELDS,
  SIAM_ID_FIELDS,
  TEXT_FIELDS,
  type TextField,
  type TextFieldName,
  fieldElementId,
  isTextField,
} from "./fields";
import { hasUnsavedChanges, useSavingInProgress, useUnsavedChanges } from "@/lib/unsaved-changes";
import { type CustomersKey, isCustomersKey, useTranslation } from "./i18n";
import { type CustomerFormValues, EMPTY_CUSTOMER } from "./model";
import { photoProblem } from "./photo";
import { PhotoZone } from "./photo-zone";

export interface CustomerFormProps {
  /** create → ปุ่ม "เพิ่มข้อมูล" · edit → "บันทึกการแก้ไข" */
  mode: "create" | "edit";
  /** ค่าเริ่มต้น — อ่านครั้งเดียวตอน mount (refetch ระหว่างพิมพ์ไม่ล้างฟอร์ม) */
  defaultValues?: CustomerFormValues;
  /** รูปที่บันทึกไว้แล้ว (หน้าแก้ไข) */
  existingPhoto?: Blob;
  existingPhotoPending?: boolean;
  /** บันทึก — throw ApiError เมื่อไม่สำเร็จ (ฟอร์มแสดงใต้ช่องที่ API ชี้) */
  onSubmit: (values: CustomerFormValues) => Promise<void>;
  onCancel: () => void;
  /**
   * ลิงก์ไปลูกค้าเดิมเมื่อเลขบัตรซ้ำ (409) — หน้าเป็นคนสร้าง ฟอร์มจึงไม่ผูกกับ router
   * `focusable` false = ใต้ช่องที่ 1 ต้อง `tabIndex={-1}` (ห้ามแทรกลำดับ Siam ID) · true = ในแถวปุ่มท้ายฟอร์ม
   */
  renderDuplicateLink?: (existingId: string, focusable: boolean) => ReactNode;
  /** โฟกัสช่องที่ 1 ตอนเปิด — หน้าเพิ่มเท่านั้น (หน้าแก้ไขห้าม: อ่านบัตรผิดช่องค่าจะเลื่อนทั้งแถว) */
  autoFocus?: boolean;
}

/** validator คืน key ของข้อความ — แปลตอนแสดง */
type Validate = (props: { value: string }) => CustomersKey | undefined;

/** เลขบัตร: รูปแบบตรวจหลังออกจากช่อง · ช่องว่างเตือนตอนบันทึก (ไม่เตือนระหว่างรอ Siam ID) */
const nationalIdFormat: Validate = ({ value }) =>
  value.trim() === "" || isValidNationalId(value) ? undefined : "validation.nationalIdInvalid";
const nationalIdRequired: Validate = ({ value }) =>
  value.trim() === "" ? "validation.nationalIdRequired" : nationalIdFormat({ value });
const nameRequired: Validate = ({ value }) => (value.trim() === "" ? "validation.nameRequired" : undefined);

/** API บังคับแค่ 2 ช่อง — ความยาวและรูปแบบอื่นให้ API ตัดสิน (ฟอร์มไม่แก้ค่าที่ Siam ID พิมพ์) */
const VALIDATORS: Partial<Record<TextFieldName, { onBlur?: Validate; onSubmit?: Validate }>> = {
  national_id: { onBlur: nationalIdFormat, onSubmit: nationalIdRequired },
  name_th: { onSubmit: nameRequired },
};

const errorKeysOf = (errors: readonly unknown[]): CustomersKey[] => errors.filter(isCustomersKey);

/** โฟกัส + เลือกข้อความทั้งช่อง (onFocus ของช่องเลือกให้) — อ่านบัตรซ้ำจะเขียนทับ ไม่ต่อท้าย */
const focusElement = (id: string) => document.getElementById(id)?.focus();

/**
 * Enter ไม่บันทึก (Siam ID บางรุ่นกด Enter ท้ายข้อมูล) — กันทั้ง implicit submit ในช่อง, กรอบรูป และปุ่มของฟอร์ม
 * ยกเว้น: ที่อยู่ (Enter = ขึ้นบรรทัด) · ลิงก์ · Ctrl/⌘+Enter (= บันทึก)
 */
function blockPlainEnter(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key !== "Enter" || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
  if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLAnchorElement) return;
  event.preventDefault();
}

/**
 * ฟอร์มลูกค้า 11 ช่องตามลำดับ Siam ID (CLAUDE.md กฎ 6) — ใช้ทั้งเพิ่มและแก้
 * ลำดับ DOM = ลำดับ Tab = SIAM_ID_FIELDS · element อื่นที่รับโฟกัสได้ก่อนปุ่มบันทึกเป็น tabIndex −1 ทั้งหมด
 * ค่าที่ส่งคือค่าดิบตามที่พิมพ์ · ตรวจหลังออกจากช่องเท่านั้น · บันทึกด้วยปุ่มหรือ Ctrl+Enter
 */
/** ค่าในฟอร์มต่างจากค่าตั้งต้น (เทียบทีละช่อง — ข้อความ/ไฟล์รูป) */
function differsFrom(values: CustomerFormValues, initial: CustomerFormValues): boolean {
  return (Object.keys(initial) as (keyof CustomerFormValues)[]).some((key) => values[key] !== initial[key]);
}

export function CustomerForm({
  mode,
  defaultValues = EMPTY_CUSTOMER,
  existingPhoto,
  existingPhotoPending,
  onSubmit,
  onCancel,
  renderDuplicateLink,
  autoFocus = false,
}: CustomerFormProps) {
  const { t } = useTranslation("customers");
  const [initialValues] = useState(defaultValues);
  const today = useBusinessDate();
  const [serverError, setServerError] = useState<ServerError | null>(null);
  const [photoIssue, setPhotoIssue] = useState<CustomersKey | null>(null);
  /** ค่าช่อง "วันที่บัตรหมดอายุ" ตอนออกจากช่องครั้งล่าสุด — ข้อความสถานะบัตรคิดจากค่านี้ (ไม่เปลี่ยนระหว่างพิมพ์) */
  const [expiryAtBlur, setExpiryAtBlur] = useState<string | null>(null);
  const busy = useRef(false);
  const saveButton = useRef<HTMLButtonElement>(null);

  const form = useForm({
    defaultValues: initialValues,
    // error เก่าที่ค้างจาก blur ต้องไม่ทำให้ Ctrl+Enter เงียบ — ตอนบันทึก TanStack ตรวจทุกช่องใหม่อยู่แล้ว
    canSubmitWhenInvalid: true,
    onSubmitInvalid: ({ formApi }) => {
      const first = TEXT_FIELDS.find((f) => errorKeysOf(formApi.getFieldMeta(f.name)?.errors ?? []).length > 0);
      if (first) focusElement(first.id);
    },
    onSubmit: async ({ value }) => {
      try {
        await onSubmit(value);
      } catch (error) {
        const mapped = mapServerError(error);
        setServerError(mapped);
        if (mapped.field) focusElement(fieldElementId(mapped.field));
        else saveButton.current?.focus();
      }
    },
  });
  const submitting = useStore(form.store, (state) => state.isSubmitting);
  // เทียบค่าจริงกับค่าตั้งต้น (isDirty ของ TanStack ติดค้างแม้พิมพ์กลับเป็นค่าเดิม)
  const dirty = useStore(form.store, (state) => differsFrom(state.values, initialValues));
  // สลับสาขาล้างฟอร์มนี้ — ถามยืนยันก่อน · ระหว่างส่งห้ามสลับ (hooks/use-branch-switch.ts)
  useUnsavedChanges(dirty);
  useSavingInProgress(submitting);

  /** กดซ้ำ/Ctrl+Enter ซ้ำระหว่างส่ง = ส่งครั้งเดียว */
  const submit = async () => {
    if (busy.current) return;
    busy.current = true;
    setServerError(null);
    try {
      await form.handleSubmit();
    } finally {
      busy.current = false;
    }
  };

  const onShortcut = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.isComposing) return;
    event.preventDefault();
    void submit();
  });
  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => onShortcut(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // ข้อมูลที่ยังไม่บันทึก — เตือนก่อนรีโหลด/ปิดแท็บ (เช่น Tab เกินไปถึงแถบที่อยู่แล้วกด Enter)
  useEffect(() => {
    if (!dirty) return;
    // ผู้ใช้ยอมทิ้งแล้ว (releaseUnsavedChanges ก่อน reload หลังสลับสาขา) = ไม่ถามซ้ำ
    const warn = (event: BeforeUnloadEvent) => {
      if (hasUnsavedChanges()) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** "อ่านบัตรใหม่" — ล้างช่อง 1–8 และรูปใหม่ แล้วโฟกัสช่องที่ 1 ให้ Siam ID พิมพ์ทับ */
  const clearCard = () => {
    for (const name of CARD_FIELDS) {
      form.setFieldValue(name, "", { dontValidate: true });
      form.setFieldMeta(name, (meta) => ({ ...meta, errorMap: {}, errorSourceMap: {} }));
    }
    form.setFieldValue("photo", null, { dontValidate: true });
    setServerError(null);
    setPhotoIssue(null);
    setExpiryAtBlur(null);
    focusElement(fieldElementId("national_id"));
  };

  const serverMessageFor = (name: string) =>
    serverError?.field === name ? [t(serverError.key, serverError.vars)] : [];
  const duplicateId = serverError?.field === "national_id" ? serverError.existingId : undefined;

  return (
    <form
      noValidate
      autoComplete="off"
      aria-label={t(mode === "create" ? "form.nameCreate" : "form.nameEdit")}
      onSubmit={(event) => event.preventDefault()}
      onKeyDown={blockPlainEnter}
      className="flex max-w-2xl flex-col gap-6 rounded-xl border bg-card p-4 text-card-foreground shadow-sm md:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-muted p-3 text-sm">
        <p className="max-w-prose">{t(mode === "create" ? "form.hintCreate" : "form.hintEdit")}</p>
        <Button type="button" variant="outline" size="sm" tabIndex={-1} onClick={clearCard}>
          <Eraser aria-hidden="true" />
          {t("form.readCard")}
        </Button>
      </div>

      <FieldGroup className="gap-5">
        {SIAM_ID_FIELDS.map((def) =>
          isTextField(def) ? (
            <form.Field key={def.name} name={def.name} validators={VALIDATORS[def.name]}>
              {(field) => (
                <TextEntry
                  def={def}
                  value={field.state.value}
                  messages={[
                    ...new Set([
                      ...errorKeysOf(field.state.meta.errors).map((key) => t(key)),
                      ...serverMessageFor(def.name),
                    ]),
                  ]}
                  suffix={
                    def.name === "national_id" && duplicateId && renderDuplicateLink
                      ? renderDuplicateLink(duplicateId, false)
                      : undefined
                  }
                  status={
                    def.name === "card_expire_text" ? <ExpiryStatus text={expiryAtBlur} today={today} /> : undefined
                  }
                  autoFocus={autoFocus && def.name === "national_id"}
                  onChange={(value) => {
                    field.handleChange(value);
                    if (serverError?.field === def.name) setServerError(null);
                  }}
                  onBlur={() => {
                    field.handleBlur();
                    if (def.name === "card_expire_text") setExpiryAtBlur(field.state.value);
                  }}
                />
              )}
            </form.Field>
          ) : (
            <form.Field key={def.name} name="photo">
              {(field) => (
                <PhotoZone
                  id={def.id}
                  label={t("fields.photo.label")}
                  value={field.state.value}
                  existing={existingPhoto}
                  existingPending={existingPhotoPending}
                  errors={[...(photoIssue ? [t(photoIssue)] : []), ...serverMessageFor("photo")]}
                  onFile={(file) => {
                    const problem = photoProblem(file);
                    setPhotoIssue(problem);
                    if (problem) return;
                    field.handleChange(file);
                    if (serverError?.field === "photo") setServerError(null);
                  }}
                  onRemove={() => {
                    field.handleChange(null);
                    setPhotoIssue(null);
                  }}
                  onProblem={setPhotoIssue}
                />
              )}
            </form.Field>
          ),
        )}
      </FieldGroup>

      {serverError && !serverError.field && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription className="text-destructive">{t(serverError.key, serverError.vars)}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          ref={saveButton}
          type="button"
          aria-disabled={submitting || undefined}
          aria-keyshortcuts="Control+Enter"
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          onClick={() => void submit()}
        >
          {submitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {t(submitting ? "form.saving" : mode === "create" ? "form.create" : "form.save")}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("form.cancel")}
        </Button>
        {duplicateId && renderDuplicateLink?.(duplicateId, true)}
        <p className="text-sm text-muted-foreground">
          {t("form.shortcut")}{" "}
          <KbdGroup>
            <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd>
          </KbdGroup>
        </p>
      </div>
    </form>
  );
}

interface TextEntryProps {
  def: TextField;
  value: string;
  /** ข้อความ error ที่แปลแล้ว */
  messages: string[];
  /** ต่อท้ายข้อความ error (ลิงก์ลูกค้าเดิมเมื่อเลขบัตรซ้ำ) */
  suffix?: ReactNode;
  /** ข้อความสถานะใต้ช่อง (ช่องที่ 8) — มีกล่อง aria-live ตลอด เนื้อหามาหลังออกจากช่อง */
  status?: ReactNode;
  autoFocus: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
}

/** ช่องข้อความ 1 ช่อง — ไม่มี name (FormData สร้างจาก state) · id กลาง ๆ กัน autofill ของ browser */
function TextEntry({ def, value, messages, suffix, status, autoFocus, onChange, onBlur }: TextEntryProps) {
  const { t } = useTranslation("customers");
  const invalid = messages.length > 0;
  const errorId = `${def.id}-error`;
  const statusId = `${def.id}-status`;
  const describedBy = [status !== undefined && statusId, invalid && errorId].filter(Boolean).join(" ") || undefined;
  const control = {
    id: def.id,
    value,
    placeholder: t(`fields.${def.name}.placeholder`),
    autoComplete: "off",
    spellCheck: false,
    autoFocus,
    "aria-invalid": invalid || undefined,
    "aria-required": def.required || undefined,
    "aria-describedby": describedBy,
    className: "md:text-base",
    // Tab เข้าช่อง input เลือกทั้งช่องเองอยู่แล้ว — ทำให้ textarea และการโฟกัสด้วยโค้ดเหมือนกัน
    onFocus: (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => event.currentTarget.select(),
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
    onBlur,
  };

  return (
    <Field data-invalid={invalid || undefined}>
      <div className="flex items-baseline gap-2">
        <FieldLabel htmlFor={def.id}>{t(`fields.${def.name}.label`)}</FieldLabel>
        {def.important && <span className="text-sm text-destructive">{t("form.important")}</span>}
      </div>
      {def.kind === "textarea" ? <Textarea rows={3} {...control} /> : <Input type="text" {...control} />}
      {status !== undefined && (
        <FieldDescription id={statusId} aria-live="polite">
          {status}
        </FieldDescription>
      )}
      {invalid && (
        <FieldError id={errorId}>
          {messages.join(" · ")}
          {suffix && <> · {suffix}</>}
        </FieldError>
      )}
    </Field>
  );
}

/** สถานะบัตรจากช่องที่ 8 หลังออกจากช่อง — แจ้งเฉย ๆ ไม่บล็อกการบันทึก (ด่านจริงอยู่ที่ /buy) */
function ExpiryStatus({ text, today }: { text: string | null; today: string }) {
  const { t } = useTranslation("customers");
  if (text === null) return null;
  const { status, message } = expiryPreview(text, today);
  const Icon = status === "ok" ? CircleCheck : TriangleAlert;
  return (
    <span className={cn("inline-flex items-center gap-1.5", status === "ok" ? "text-foreground" : "text-destructive")}>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {t(message.key, message.vars)}
    </span>
  );
}

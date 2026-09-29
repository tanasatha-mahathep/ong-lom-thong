import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, type RefObject, useId, useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ApiError, errorMessage } from "@/lib/api";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import { type GoldPriceT, useTranslation } from "./i18n";
import {
  type ReferencePrefill,
  type SaveGoldPriceBody,
  barSellErrorOf,
  goldPriceQuoteQueryOptions,
  typoWarningOf,
} from "./queries";

/** หน่วง live preview ระหว่างพิมพ์ (spec §14.3) */
const QUOTE_DEBOUNCE_MS = 300;

/** error ที่ไม่ได้ชี้ช่อง — ข้อความไทยของเราเอง ไม่แสดงข้อความดิบของเซิร์ฟเวอร์ (อาจเป็นภาษาอังกฤษ) */
export function requestErrorMessage(t: GoldPriceT, error: unknown, action: "save" | "quote" | "clear"): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return errorMessage(error);
    if (error.status === 403) return t("errors.forbidden");
    // มีได้เฉพาะ endpoint ของสาขา: สาขาถูกปิด/ถูกถอนสิทธิ์ระหว่างเปิดหน้านี้
    if (error.status === 404) return t("errors.branchNotFound");
  }
  return t(`errors.${action}Failed`);
}

interface TypoWarning {
  barSell: string;
  warning: string;
  fromReference: ReferencePrefill | null;
}

/** ราคาสมาคมที่เติมลงช่อง — ข้อความในช่อง + ประกาศที่มา */
interface Prefilled extends ReferencePrefill {
  value: string;
}

/** ราคาสมาคม (อ้างอิง) ตัวล่าสุดที่หน้าเห็น — ใช้ตรวจว่าค่าที่เติมไว้ยังตรงกับประกาศล่าสุดหรือไม่ */
export interface CurrentReference extends ReferencePrefill {
  bar_sell: string;
}

interface PriceFormOptions<TSaved> {
  /** ช่องราคาของ component ที่เรียก — hook ใช้แค่ใน event handler (โฟกัสกลับ) ไม่อ่านตอน render */
  inputRef: RefObject<HTMLInputElement | null>;
  /** ตั้งราคาเฉพาะสาขา — quote เทียบราคาที่สาขานี้ใช้ครั้งก่อน (ไม่ส่ง = ราคากลาง) */
  branchId?: string;
  save: (body: SaveGoldPriceBody) => Promise<TSaved>;
  onSaved: (saved: TSaved) => Promise<void> | void;
  /** error ที่ไม่ใช่ด่านกันพิมพ์ผิด (เช่น 404 → โหลดรายการสาขาใหม่) */
  onFailed?: (error: Error) => void;
  /** ราคาสมาคมล่าสุด (null = ไม่มี/ดึงไม่ได้) — ประกาศใหม่มาหลังเติมค่า = เตือน + ไม่นับว่ามาจากราคาสมาคมถ้าราคาไม่ตรง */
  currentReference?: CurrentReference | null;
}

/**
 * ฟอร์มค่าเดียวของราคาทอง: พิมพ์ → quote สดจากเซิร์ฟเวอร์ → Enter บันทึก — ราคากลางและราคาเฉพาะสาขาใช้ตัวเดียวกัน
 * ด่านกันพิมพ์ผิด (409 · field "confirm_typo") → `typo` มีค่า → หน้าแสดง TypoConfirmDialog → `confirmTypo()` ส่งซ้ำ
 * browser ไม่คำนวณราคา — ตัวเลขทุกตัวใน preview มาจาก POST /gold-price/quote
 */
export function usePriceForm<TSaved>({
  inputRef,
  branchId,
  save: saveFn,
  onSaved,
  onFailed,
  currentReference = null,
}: PriceFormOptions<TSaved>) {
  const { t } = useTranslation("goldPrice");
  const base = useId();
  const [text, setText] = useState("");
  const [missing, setMissing] = useState(false);
  const [typo, setTypo] = useState<TypoWarning | null>(null);
  /** ข้อความที่เติมจากราคาสมาคม (อ้างอิง) — ยังไม่ได้บันทึก · พิมพ์แก้แล้วไม่นับว่ามาจากราคาสมาคม */
  const [prefilled, setPrefilled] = useState<Prefilled | null>(null);

  const barSell = normalizeDecimalInput(text);
  // ช่องยังเป็นค่าที่เติมไว้ · ประกาศเปลี่ยนหลังเติม = เตือน · ราคาใหม่ไม่ตรงกับค่าในช่อง = ไม่นับว่ามาจากราคาสมาคม
  // (เทียบข้อความจาก API ที่รูปเดียวกัน "68250.00" — ไม่ใช่การคำนวณเงิน)
  const stillPrefilled = prefilled !== null && text === prefilled.value;
  const referenceChanged =
    stillPrefilled && currentReference !== null && currentReference.announced_at !== prefilled.announced_at;
  const fromReference: ReferencePrefill | null =
    stillPrefilled && (!referenceChanged || currentReference?.bar_sell === prefilled.value)
      ? { announced_at: prefilled.announced_at, round: prefilled.round }
      : null;
  const debounced = useDebouncedValue(barSell, QUOTE_DEBOUNCE_MS);
  const quote = useQuery({ ...goldPriceQuoteQueryOptions(debounced, branchId), placeholderData: keepPreviousData });

  // error อื่น: กลับไปที่ช่องราคาพร้อมเลือกข้อความ พิมพ์ทับได้ทันที
  const focusInput = () => {
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const save = useMutation({
    mutationFn: saveFn,
    onSuccess: async (saved) => {
      setText("");
      setPrefilled(null);
      await onSaved(saved);
    },
    onError: (error, body) => {
      const warning = typoWarningOf(error);
      if (warning && !body.confirm_typo) {
        setTypo({ barSell: body.bar_sell, warning, fromReference: body.from_reference ?? null });
        return;
      }
      onFailed?.(error);
      focusInput();
    },
  });

  // ระหว่างพิมพ์/รอคำตอบ ผล quote ที่เห็นยังเป็นของข้อความก่อนหน้า
  const idle = barSell === "";
  const busy = !idle && (barSell !== debounced || quote.isFetching);
  const quoteError = idle || busy ? null : quote.error;

  const fieldError = missing ? t("errors.missing") : (barSellErrorOf(save.error) ?? barSellErrorOf(quoteError));
  const formError =
    save.error && !barSellErrorOf(save.error) && !typoWarningOf(save.error)
      ? requestErrorMessage(t, save.error, "save")
      : null;

  const ids = {
    input: `${base}-bar-sell`,
    hint: `${base}-hint`,
    error: `${base}-error`,
    formError: `${base}-form-error`,
    preview: `${base}-preview-title`,
  };

  return {
    ids,
    text,
    changeText: (value: string) => {
      setText(value);
      setMissing(false);
      save.reset();
    },
    /**
     * เติมช่องราคาด้วยราคาสมาคม (อ้างอิง) — **ไม่บันทึก** ผู้จัดการต้องกดบันทึกเอง (ด่านกันพิมพ์ผิดยังทำงาน)
     * `focus` = ย้ายโฟกัสไปช่องราคา (กดปุ่มเติมเอง) · เติมอัตโนมัติตอนเปิดหน้าไม่ย้ายโฟกัส
     */
    prefill: (reference: CurrentReference, { focus = true }: { focus?: boolean } = {}) => {
      setText(reference.bar_sell);
      setPrefilled({ value: reference.bar_sell, announced_at: reference.announced_at, round: reference.round });
      setMissing(false);
      save.reset();
      if (focus) focusInput();
    },
    /** ข้อความในช่องยังเป็นค่าที่เติมจากราคาสมาคม (ยังไม่ได้บันทึก) — ประกาศที่มา · null = ไม่ใช่ */
    fromReference,
    /** เติมค่าไว้แล้วมีประกาศใหม่ของสมาคม — ค่าในช่องอาจไม่ตรงกับประกาศล่าสุด */
    referenceChanged,
    idle,
    busy,
    preview: idle ? undefined : quote.data,
    previewError: quoteError && !barSellErrorOf(quoteError) ? requestErrorMessage(t, quoteError, "quote") : null,
    fieldError,
    formError,
    /** error ใต้ช่องก่อน · error ของฟอร์ม · คำอธิบาย — ลำดับที่ screen reader อ่าน */
    describedBy: [fieldError && ids.error, formError && ids.formError, ids.hint].filter(Boolean).join(" "),
    saving: save.isPending,
    submit: (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (save.isPending) return;
      if (idle) {
        setMissing(true);
        inputRef.current?.focus();
        return;
      }
      save.mutate(fromReference ? { bar_sell: barSell, from_reference: fromReference } : { bar_sell: barSell });
    },
    typo,
    dismissTypo: () => setTypo(null),
    confirmTypo: () => {
      if (typo) {
        save.mutate({
          bar_sell: typo.barSell,
          confirm_typo: true,
          ...(typo.fromReference ? { from_reference: typo.fromReference } : {}),
        });
      }
    },
    /** ปิดด่านกันพิมพ์ผิดแล้ว — กลับไปที่ช่องราคา (ตัวเลขเดิมยังอยู่) */
    returnToInput: () => inputRef.current?.focus(),
  };
}

export type PriceForm = ReturnType<typeof usePriceForm>;

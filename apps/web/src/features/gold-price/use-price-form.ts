import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, type RefObject, useId, useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ApiError, errorMessage } from "@/lib/api";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import { type GoldPriceT, useTranslation } from "./i18n";
import { type SaveGoldPriceBody, barSellErrorOf, goldPriceQuoteQueryOptions, typoWarningOf } from "./queries";

/** หน่วง live preview ระหว่างพิมพ์ (spec §14.3) */
const QUOTE_DEBOUNCE_MS = 300;

/** error ที่ไม่ได้ชี้ช่อง — ข้อความไทยของเราเอง ไม่แสดงข้อความดิบของเซิร์ฟเวอร์ (อาจเป็นภาษาอังกฤษ) */
export function requestErrorMessage(t: GoldPriceT, error: unknown, action: "save" | "quote"): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return errorMessage(error);
    if (error.status === 403) return t("errors.forbidden");
  }
  return t(`errors.${action}Failed`);
}

interface TypoWarning {
  barSell: string;
  warning: string;
}

interface PriceFormOptions<TSaved> {
  /** ช่องราคาของ component ที่เรียก — hook ใช้แค่ใน event handler (โฟกัสกลับ) ไม่อ่านตอน render */
  inputRef: RefObject<HTMLInputElement | null>;
  save: (body: SaveGoldPriceBody) => Promise<TSaved>;
  onSaved: (saved: TSaved) => Promise<void> | void;
}

/**
 * ฟอร์มค่าเดียวของราคาทอง: พิมพ์ → quote สดจากเซิร์ฟเวอร์ → Enter บันทึก
 * ด่านกันพิมพ์ผิด (409 · field "confirm_typo") → `typo` มีค่า → หน้าแสดง TypoConfirmDialog → `confirmTypo()` ส่งซ้ำ
 * browser ไม่คำนวณราคา — ตัวเลขทุกตัวใน preview มาจาก POST /gold-price/quote
 */
export function usePriceForm<TSaved>({ inputRef, save: saveFn, onSaved }: PriceFormOptions<TSaved>) {
  const { t } = useTranslation("goldPrice");
  const base = useId();
  const [text, setText] = useState("");
  const [missing, setMissing] = useState(false);
  const [typo, setTypo] = useState<TypoWarning | null>(null);

  const barSell = normalizeDecimalInput(text);
  const debounced = useDebouncedValue(barSell, QUOTE_DEBOUNCE_MS);
  const quote = useQuery({ ...goldPriceQuoteQueryOptions(debounced), placeholderData: keepPreviousData });

  // error อื่น: กลับไปที่ช่องราคาพร้อมเลือกข้อความ พิมพ์ทับได้ทันที
  const focusInput = () => {
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const save = useMutation({
    mutationFn: saveFn,
    onSuccess: async (saved) => {
      setText("");
      await onSaved(saved);
    },
    onError: (error, body) => {
      const warning = typoWarningOf(error);
      if (warning && !body.confirm_typo) {
        setTypo({ barSell: body.bar_sell, warning });
        return;
      }
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
      save.mutate({ bar_sell: barSell });
    },
    typo,
    dismissTypo: () => setTypo(null),
    confirmTypo: () => {
      if (typo) save.mutate({ bar_sell: typo.barSell, confirm_typo: true });
    },
    /** ปิดด่านกันพิมพ์ผิดแล้ว — กลับไปที่ช่องราคา (ตัวเลขเดิมยังอยู่) */
    returnToInput: () => inputRef.current?.focus(),
  };
}

export type PriceForm = ReturnType<typeof usePriceForm>;

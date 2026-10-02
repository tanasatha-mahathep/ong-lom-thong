import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, type RefObject, useId, useRef, useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ApiError, errorMessage } from "@/lib/api";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import { type GoldPriceT, useTranslation } from "./i18n";
import {
  PER_GRAM_FIELDS,
  type PerGramBody,
  type PerGramField,
  type ReferencePrefill,
  type SaveGoldPriceBody,
  barSellErrorOf,
  fieldErrorOf,
  goldPriceQuoteQueryOptions,
  perGramFieldOf,
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

/** 409 ของด่านกันพิมพ์ผิด — เก็บ body ที่ส่งไปทั้งก้อน ยืนยันแล้วส่งซ้ำตัวเดิมพร้อม confirm_typo */
interface TypoWarning {
  body: SaveGoldPriceBody;
  warning: string;
}

/** ราคาต่อกรัมของวันนี้ที่ใช้อยู่ (ค่าจาก API) — null = ยังไม่ได้ตั้ง */
export type PerGramPrices = Record<PerGramField, string | null>;

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
  /**
   * มีช่องราคาเงิน/แพลตตินั่มต่อกรัม (ราคากลางเท่านั้น — API ปฏิเสธที่ราคาเฉพาะสาขา) · ไม่ส่ง = ไม่มีช่อง
   * `current` = ราคาของวันนี้ที่ใช้อยู่ (เติมในช่องให้) · undefined = ยังไม่รู้ (กำลังโหลด/โหลดล้ม)
   */
  perGram?: { current: PerGramPrices | undefined };
}

/**
 * ช่องราคาต่อกรัม: ค่าที่แสดง = ที่พิมพ์ (ถ้าแตะแล้ว) ไม่งั้นราคาของวันนี้ที่ใช้อยู่ — ไม่ copy ลง state จึงตามราคาใหม่เองเมื่อโหลดเสร็จ
 * ส่งเฉพาะช่องที่ต่างจากราคาของวันนี้ (ไม่มีคีย์ = API คงค่าเดิม): บันทึกราคาทองระหว่างวันจึงไม่ล้าง/ไม่ทับราคาเงินที่ตั้งไว้
 * และไม่เตือนด่านกันพิมพ์ผิดของราคาที่ยืนยันไปแล้วซ้ำ · ยังไม่รู้ราคาของวันนี้ = ส่งเฉพาะช่องที่พิมพ์ (ไม่เคยส่ง null)
 * ล้างช่องที่เคยตั้ง = null (วันนี้รับซื้อโลหะนั้นไม่ได้) — เทียบข้อความล้วน ไม่คำนวณ
 */
function perGramChanges(edits: Partial<Record<PerGramField, string>>, current: PerGramPrices | undefined): PerGramBody {
  const body: PerGramBody = {};
  for (const field of PER_GRAM_FIELDS) {
    const typed = edits[field];
    if (typed === undefined) continue;
    const value = normalizeDecimalInput(typed);
    if (current === undefined ? value === "" : value === (current[field] ?? "")) continue;
    body[field] = value === "" ? null : value;
  }
  return body;
}

/**
 * ฟอร์มราคาทอง: พิมพ์ → quote สดจากเซิร์ฟเวอร์ → Enter บันทึก — ราคากลางและราคาเฉพาะสาขาใช้ตัวเดียวกัน
 * ราคากลางมีช่องราคาเงิน/แพลตตินั่มต่อกรัมเพิ่ม (option `perGram`) ส่งไปกับ quote/บันทึกครั้งเดียวกัน
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
  perGram,
}: PriceFormOptions<TSaved>) {
  const { t } = useTranslation("goldPrice");
  const base = useId();
  const [text, setText] = useState("");
  const [missing, setMissing] = useState(false);
  const [typo, setTypo] = useState<TypoWarning | null>(null);
  /** ข้อความที่เติมจากราคาสมาคม (อ้างอิง) — ยังไม่ได้บันทึก · พิมพ์แก้แล้วไม่นับว่ามาจากราคาสมาคม */
  const [prefilled, setPrefilled] = useState<Prefilled | null>(null);
  /** ช่องราคาต่อกรัมที่แตะแล้ว — ไม่มีคีย์ = ยังแสดงราคาของวันนี้ */
  const [perGramEdits, setPerGramEdits] = useState<Partial<Record<PerGramField, string>>>({});
  const silverRef = useRef<HTMLInputElement>(null);
  const platinumRef = useRef<HTMLInputElement>(null);
  const perGramRefs: Record<PerGramField, RefObject<HTMLInputElement | null>> = {
    silver_per_g: silverRef,
    platinum_per_g: platinumRef,
  };

  const barSell = normalizeDecimalInput(text);
  const perGramBody = perGram ? perGramChanges(perGramEdits, perGram.current) : {};
  // ช่องยังเป็นค่าที่เติมไว้ · ประกาศเปลี่ยนหลังเติม = เตือน · ราคาใหม่ไม่ตรงกับค่าในช่อง = ไม่นับว่ามาจากราคาสมาคม
  // (เทียบข้อความจาก API ที่รูปเดียวกัน "68250.00" — ไม่ใช่การคำนวณเงิน)
  const stillPrefilled = prefilled !== null && text === prefilled.value;
  const referenceChanged =
    stillPrefilled && currentReference !== null && currentReference.announced_at !== prefilled.announced_at;
  const fromReference: ReferencePrefill | null =
    stillPrefilled && (!referenceChanged || currentReference?.bar_sell === prefilled.value)
      ? { announced_at: prefilled.announced_at, round: prefilled.round }
      : null;
  // หน่วงทั้งชุดเป็นข้อความเดียว (object ใหม่ทุก render จะรีเซ็ตตัวหน่วงไม่จบ)
  const quoteInput = JSON.stringify({ barSell, perGram: perGramBody });
  const debouncedInput = useDebouncedValue(quoteInput, QUOTE_DEBOUNCE_MS);
  const debounced = JSON.parse(debouncedInput) as { barSell: string; perGram: PerGramBody };
  const quote = useQuery({
    ...goldPriceQuoteQueryOptions(debounced.barSell, branchId, debounced.perGram),
    placeholderData: keepPreviousData,
  });

  // error อื่น: กลับไปที่ช่องราคาพร้อมเลือกข้อความ พิมพ์ทับได้ทันที
  const focusInput = (ref: RefObject<HTMLInputElement | null> = inputRef) => {
    ref.current?.focus();
    ref.current?.select();
  };

  const save = useMutation({
    mutationFn: saveFn,
    onSuccess: async (saved) => {
      setText("");
      setPrefilled(null);
      await onSaved(saved);
      // หลังราคาของวันนี้อ่านใหม่แล้ว (onSaved รอ invalidate) ช่องราคาต่อกรัมกลับไปแสดงราคาที่บันทึกจริง
      setPerGramEdits({});
    },
    onError: (error, body) => {
      const warning = typoWarningOf(error);
      if (warning && !body.confirm_typo) {
        setTypo({ body, warning });
        return;
      }
      onFailed?.(error);
      const perGramField = perGramFieldOf(error);
      focusInput(perGramField ? perGramRefs[perGramField] : inputRef);
    },
  });

  // ระหว่างพิมพ์/รอคำตอบ ผล quote ที่เห็นยังเป็นของข้อความก่อนหน้า
  const idle = barSell === "";
  const busy = !idle && (quoteInput !== debouncedInput || quote.isFetching);
  const quoteError = idle || busy ? null : quote.error;
  /** error ที่ชี้ช่องใดช่องหนึ่งในฟอร์มนี้ (ไม่ใช่ error ของทั้งฟอร์ม) */
  const pointsAtField = (error: unknown) =>
    barSellErrorOf(error) !== null || (perGram !== undefined && perGramFieldOf(error) !== null);

  const fieldError = missing ? t("errors.missing") : (barSellErrorOf(save.error) ?? barSellErrorOf(quoteError));
  const formError =
    save.error && !pointsAtField(save.error) && !typoWarningOf(save.error)
      ? requestErrorMessage(t, save.error, "save")
      : null;

  const ids = {
    input: `${base}-bar-sell`,
    hint: `${base}-hint`,
    error: `${base}-error`,
    formError: `${base}-form-error`,
    preview: `${base}-preview-title`,
  };

  /** ช่องราคาต่อกรัม (เฉพาะราคากลาง) — ค่าในช่อง · error ใต้ช่อง · ค่าที่ preview แสดง */
  const perGramFields = perGram
    ? PER_GRAM_FIELDS.map((field) => {
        const error = fieldErrorOf(save.error, field) ?? fieldErrorOf(quoteError, field);
        return {
          field,
          ref: perGramRefs[field],
          ids: { input: `${base}-${field}`, error: `${base}-${field}-error` },
          text: perGramEdits[field] ?? perGram.current?.[field] ?? "",
          error,
          change: (value: string) => {
            setPerGramEdits((edits) => ({ ...edits, [field]: value }));
            save.reset();
          },
        };
      })
    : [];

  /**
   * ราคาต่อกรัมใน preview "ราคาที่จะบันทึก" — ช่องที่เปลี่ยน = รูปมาตรฐานที่ quote ตอบ · ไม่เปลี่ยน = ราคาของวันนี้ที่คงไว้
   * undefined = ฟอร์มนี้ไม่มีช่องราคาต่อกรัม
   */
  const preview = idle ? undefined : quote.data;
  const perGramPreview: PerGramPrices | undefined = perGram
    ? {
        silver_per_g:
          preview && "silver_per_g" in debounced.perGram
            ? (preview.silver_per_g ?? null)
            : (perGram.current?.silver_per_g ?? null),
        platinum_per_g:
          preview && "platinum_per_g" in debounced.perGram
            ? (preview.platinum_per_g ?? null)
            : (perGram.current?.platinum_per_g ?? null),
      }
    : undefined;

  const send = (body: SaveGoldPriceBody) => save.mutate({ ...body, ...perGramBody });

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
    preview,
    perGramFields,
    perGramPreview,
    previewError: quoteError && !pointsAtField(quoteError) ? requestErrorMessage(t, quoteError, "quote") : null,
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
      send(fromReference ? { bar_sell: barSell, from_reference: fromReference } : { bar_sell: barSell });
    },
    typo,
    dismissTypo: () => setTypo(null),
    confirmTypo: () => {
      if (typo) save.mutate({ ...typo.body, confirm_typo: true });
    },
    /** ปิดด่านกันพิมพ์ผิดแล้ว — กลับไปที่ช่องราคา (ตัวเลขเดิมยังอยู่) */
    returnToInput: () => inputRef.current?.focus(),
  };
}

export type PriceForm = ReturnType<typeof usePriceForm>;

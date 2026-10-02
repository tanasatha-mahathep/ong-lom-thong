import { CircleAlert, LoaderCircle, TriangleAlert } from "lucide-react";
import type { RefObject } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatBoardPrice, formatInteger, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useTranslation } from "./i18n";
import { PER_GRAM_FIELDS } from "./queries";
import type { PerGramPrices, PriceForm } from "./use-price-form";

/** ราคา 3 ค่าของวัน — null = ยังไม่มีราคา (แสดง "–") */
export interface Prices {
  bar_sell: string | null;
  bar_buy: string | null;
  jewelry_buy: string | null;
}

/** error ของทั้งฟอร์ม (ไม่ชี้ช่อง) — ผูกกับช่องราคาด้วย aria-describedby ผ่าน `form.describedBy` */
export function PriceFormError({ form }: { form: PriceForm }) {
  if (!form.formError) return null;
  return (
    <Alert id={form.ids.formError} variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertDescription className="text-destructive">{form.formError}</AlertDescription>
    </Alert>
  );
}

/** ช่องราคาทองแท่งขายออก — พิมพ์ตัวเลขแล้ว Enter (form submit) · readOnly ระหว่างบันทึก */
export function PriceInputField({
  form,
  inputRef,
  label,
  autoFocus = false,
}: {
  form: PriceForm;
  inputRef: RefObject<HTMLInputElement | null>;
  label: string;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation("goldPrice");
  return (
    <Field data-invalid={!!form.fieldError}>
      <FieldLabel htmlFor={form.ids.input}>{label}</FieldLabel>
      <Input
        ref={inputRef}
        id={form.ids.input}
        name="bar_sell"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        required
        readOnly={form.saving}
        value={form.text}
        onChange={(event) => form.changeText(event.target.value)}
        aria-invalid={!!form.fieldError}
        aria-describedby={form.describedBy}
        className="h-12 text-2xl font-semibold tabular-nums md:text-2xl"
      />
      <FieldDescription id={form.ids.hint}>{t("barSellHint")}</FieldDescription>
      <FieldError id={form.ids.error}>{form.fieldError}</FieldError>
    </Field>
  );
}

/**
 * ช่องราคาเงิน/แพลตตินั่มต่อกรัม (เฉพาะราคากลาง · ไม่บังคับ) — เติมราคาของวันนี้ไว้ให้ · Enter บันทึกพร้อมราคาทอง
 * ฟอร์มที่ไม่มีช่องนี้ (ราคาเฉพาะสาขา) ไม่ render อะไร
 */
export function PerGramInputs({ form }: { form: PriceForm }) {
  const { t } = useTranslation("goldPrice");
  if (form.perGramFields.length === 0) return null;
  const hintId = `${form.ids.input}-per-gram-hint`;
  return (
    <FieldSet className="gap-3">
      <FieldLegend variant="label">{t("perGram.legend")}</FieldLegend>
      {/* การ์ดครึ่งจอ (lg) แคบเกินสองช่องคู่กัน — ป้ายตัดบรรทัดไม่เท่ากัน ช่องไม่ตรงแนว */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {form.perGramFields.map((f) => (
          <Field key={f.field} data-invalid={!!f.error}>
            <FieldLabel htmlFor={f.ids.input}>{t(`perGram.${f.field}`)}</FieldLabel>
            <Input
              ref={f.ref}
              id={f.ids.input}
              name={f.field}
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              placeholder={t(`perGram.placeholder.${f.field}`)}
              readOnly={form.saving}
              value={f.text}
              onChange={(event) => f.change(event.target.value)}
              aria-invalid={!!f.error}
              aria-describedby={[f.error && f.ids.error, hintId].filter(Boolean).join(" ")}
              className="tabular-nums"
            />
            <FieldError id={f.ids.error}>{f.error}</FieldError>
          </Field>
        ))}
      </div>
      <FieldDescription id={hintId}>{t("perGram.hint")}</FieldDescription>
    </FieldSet>
  );
}

/** ผลจาก POST /gold-price/quote — live region: โปรแกรมอ่านจอประกาศเมื่อคำนวณเสร็จ (aria-busy กันประกาศระหว่างพิมพ์) */
export function QuotePreview({ form }: { form: PriceForm }) {
  const { t } = useTranslation("goldPrice");
  const warning = form.preview?.warning;
  return (
    <section aria-labelledby={form.ids.preview} className="grid gap-3 rounded-lg border p-4">
      <h3 id={form.ids.preview} className="text-sm font-medium">
        {t("preview.title")}
      </h3>
      <div role="status" aria-busy={form.busy} className="grid gap-3">
        {form.idle ? (
          <p className="text-sm text-muted-foreground">{t("preview.idle")}</p>
        ) : (
          <>
            <PriceList prices={form.preview} perGram={form.perGramPreview} muted={form.busy} />
            {form.busy ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                {t("preview.busy")}
              </p>
            ) : form.previewError ? (
              <p className="text-sm text-destructive">{form.previewError}</p>
            ) : (
              warning && (
                <p className="flex gap-2 rounded-md border border-warning-border bg-warning p-3 text-sm text-warning-foreground">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {warning}
                </p>
              )
            )}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * ราคาของวันแบบรายการ — ทอง 3 ค่า + (ถ้าส่งมา) ราคาเงิน/แพลตตินั่มต่อกรัม
 * ราคาต่อกรัม null = "ยังไม่ได้ตั้ง" (ตัวอักษรเล็ก ไม่ใช่ตัวเลข — ไม่ให้อ่านเป็นราคา 0)
 */
export function PriceList({
  prices,
  perGram,
  muted = false,
}: {
  prices: Prices | undefined;
  perGram?: PerGramPrices;
  muted?: boolean;
}) {
  const { t } = useTranslation("goldPrice");
  return (
    <dl className="grid gap-2">
      <PriceRow
        label={t("goldPrice.barSell", { ns: "common" })}
        value={formatBoardPrice(prices?.bar_sell)}
        muted={muted}
      />
      <PriceRow
        label={t("goldPrice.barBuy", { ns: "common" })}
        value={formatBoardPrice(prices?.bar_buy)}
        muted={muted}
      />
      <PriceRow
        label={t("goldPrice.jewelryBuy", { ns: "common" })}
        value={formatInteger(prices?.jewelry_buy)}
        muted={muted}
      />
      {perGram &&
        PER_GRAM_FIELDS.map((field) => {
          const value = perGram[field];
          return value === null ? (
            <PriceRow key={field} label={t(`perGram.${field}`)} value={t("perGram.notSet")} muted notSet />
          ) : (
            <PriceRow key={field} label={t(`perGram.${field}`)} value={formatMoney(value)} muted={muted} />
          );
        })}
    </dl>
  );
}

function PriceRow({
  label,
  value,
  muted,
  notSet = false,
}: {
  label: string;
  value: string;
  muted: boolean;
  notSet?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          notSet ? "text-sm" : "text-xl font-semibold tabular-nums",
          (muted || notSet) && "text-muted-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** ราคาต่อกรัมที่ยังไม่ได้ตั้งของวันนี้ → บอกว่ารับซื้อโลหะนั้นไม่ได้ · ตั้งครบแล้ว = ไม่ render */
export function PerGramMissingNote({ perGram }: { perGram: PerGramPrices }) {
  const { t } = useTranslation("goldPrice");
  const missing = PER_GRAM_FIELDS.filter((field) => perGram[field] === null);
  if (missing.length === 0) return null;
  const metals = missing.map((field) => t(`perGram.metal.${field}`)).join(t("perGram.and"));
  return <p className="text-sm text-muted-foreground">{t("perGram.missing", { metals })}</p>;
}

/**
 * ด่านกันพิมพ์ผิด (409) — โฟกัสเริ่มที่ "กลับไปแก้ไข" (ค่าเริ่มต้นของ AlertDialog) Enter ซ้ำโดยไม่ได้อ่านจึงไม่ผ่านด่าน
 * ปิดแล้วกลับไปที่ช่องราคา — ไม่มีปุ่ม trigger ให้คืนโฟกัส
 */
export function TypoConfirmDialog({ form, title }: { form: PriceForm; title: string }) {
  const { t } = useTranslation("goldPrice");
  return (
    <AlertDialog
      open={form.typo !== null}
      onOpenChange={(open) => {
        if (!open) form.dismissTypo();
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          form.returnToInput();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{form.typo?.warning}</AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-sm">{t("typo.body")}</p>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("typo.back")}</AlertDialogCancel>
          <AlertDialogAction onClick={form.confirmTypo}>{t("typo.confirm")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

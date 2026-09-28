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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatBoardPrice, formatInteger } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useTranslation } from "./i18n";
import type { PriceForm } from "./use-price-form";

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
            <PriceList prices={form.preview} muted={form.busy} />
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

export function PriceList({ prices, muted = false }: { prices: Prices | undefined; muted?: boolean }) {
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
    </dl>
  );
}

function PriceRow({ label, value, muted }: { label: string; value: string; muted: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("text-xl font-semibold tabular-nums", muted && "text-muted-foreground")}>{value}</dd>
    </div>
  );
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

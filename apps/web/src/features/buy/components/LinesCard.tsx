import { CornerDownLeft, X } from "lucide-react";
import { type KeyboardEvent, useId } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, formatPercent, formatWeight } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useTranslation } from "../i18n";
import { DEDUCT_CHOICES, type LineEntryField, NO_DEDUCT, rowErrors } from "../model";
import type { BuyController } from "../use-buy-controller";
import { describedBy, isPlainEnter } from "./field-helpers";

/**
 * ของเก่าที่รับซื้อ: โลหะ (select) → ค่าบริสุทธิ์ (%) → หัก % → ปริมาณ → Enter เพิ่มแถว (API ตรวจแถวก่อนเพิ่ม)
 * ไม่มีช่องราคา — เซิร์ฟเวอร์คิดราคาจากราคาของวันให้เอง (UAT 30 ก.ย. 2569)
 * แถวเดียวตามที่เจ้าของขอ (3 ต.ค.): โลหะเป็น select · ค่าบริสุทธิ์ขึ้นมาอยู่ถัดโลหะ · ลำดับบนจอ = ลำดับ DOM = ลำดับ Tab
 */
export function LinesCard({ c }: { c: BuyController }) {
  const { t } = useTranslation("buy");
  const id = useId();
  const { state, actions, register, metals, metalId } = c;
  const entry = state.lineEntry;
  const err = state.lineError;
  const errorOf = (field: LineEntryField) => (err?.field === field ? err.message : undefined);
  const metalError = errorOf("metal_id");
  const purityError = errorOf("purity_percent");
  const deductError = errorOf("deduct_percent");
  const weightError = errorOf("weight_g");
  /** ยังไม่ได้พิมพ์อะไรในแถวกรอก แต่มีรายการแล้ว — Enter = จบรายการ ไปช่องรายละเอียด */
  const entryBlank = !entry.purity_percent.trim() && !entry.weight_g.trim();
  const finished = entryBlank && state.lines.length > 0;

  const escClears = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return false;
    e.preventDefault();
    actions.clearLineEntry();
    return true;
  };
  const onMetalKey = (e: KeyboardEvent<HTMLSelectElement>) => {
    if (escClears(e) || !isPlainEnter(e)) return;
    e.preventDefault();
    actions.focusOn("purity");
  };
  const onPurityKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (escClears(e) || !isPlainEnter(e)) return;
    e.preventDefault();
    // หลังเพิ่มแถว โฟกัสกลับมาที่ช่องนี้ — Enter ในแถวว่างจึงต้องพาออกไปได้ทันที (ไม่ต้องกด Enter ผ่านอีก 2 ช่อง)
    if (finished) actions.focusOn("detail");
    else if (entry.purity_percent.trim()) actions.focusOn("deduct");
    // ช่องบังคับยังว่าง: addLine แจ้ง "กรุณากรอกค่าบริสุทธิ์" ใต้ช่องนี้
    else void actions.addLine();
  };
  const onDeductKey = (e: KeyboardEvent<HTMLSelectElement>) => {
    if (escClears(e) || !isPlainEnter(e)) return;
    e.preventDefault();
    actions.focusOn("weight");
  };
  const onWeightKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (escClears(e) || !isPlainEnter(e)) return;
    e.preventDefault();
    if (finished) actions.focusOn("detail");
    else void actions.addLine();
  };
  const onDetailKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isPlainEnter(e)) return;
    e.preventDefault();
    actions.focusOn("paymentAmount");
  };

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base">{t("cards.lines")}</h2>
        </CardTitle>
      </CardHeader>
      {/* แถวเดียวเมื่อการ์ดกว้างพอ (@4xl = 56rem ของการ์ดเอง ไม่ใช่ของจอ — sidebar กางแล้วยังไม่ล้น) · แคบกว่านั้น 2 คอลัมน์ */}
      <CardContent className="@container/lines flex flex-col gap-4">
        <div className="grid grid-cols-2 items-start gap-4 @4xl/lines:grid-cols-[10rem_8rem_9rem_12rem_auto]">
          <Field data-invalid={!!metalError}>
            <FieldLabel htmlFor={`${id}-metal`}>{t("lines.metal")}</FieldLabel>
            {/* select ของเบราว์เซอร์: พิมพ์อักษรแรกกระโดดไปตัวเลือก · ลูกศรเปลี่ยนค่า · Enter ไปช่องค่าบริสุทธิ์ */}
            <NativeSelect
              ref={(el) => register("metal", el)}
              id={`${id}-metal`}
              value={metalId}
              onChange={(e) => actions.setLineEntry({ metal_id: e.target.value })}
              onKeyDown={onMetalKey}
              aria-invalid={!!metalError}
              aria-describedby={metalError ? `${id}-metal-error` : undefined}
            >
              {metals.map((m) => (
                <NativeSelectOption key={m.id} value={m.id}>
                  {m.name_th}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldError id={`${id}-metal-error`}>{metalError}</FieldError>
          </Field>

          <Field data-invalid={!!purityError}>
            <FieldLabel htmlFor={`${id}-purity`}>{t("lines.purity")}</FieldLabel>
            <Input
              ref={(el) => register("purity", el)}
              id={`${id}-purity`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder={t("lines.purityPlaceholder")}
              value={entry.purity_percent}
              onChange={(e) => actions.setLineEntry({ purity_percent: e.target.value })}
              onKeyDown={onPurityKey}
              aria-required="true"
              aria-invalid={!!purityError}
              aria-describedby={describedBy(purityError && `${id}-purity-error`, `${id}-price-hint`)}
              className="text-right tabular-nums"
            />
            <FieldError id={`${id}-purity-error`}>{purityError}</FieldError>
          </Field>

          <Field data-invalid={!!deductError}>
            <FieldLabel htmlFor={`${id}-deduct`}>{t("lines.deduct")}</FieldLabel>
            {/* select ของเบราว์เซอร์: Tab เข้าได้ · พิมพ์เลขกระโดดไปตัวเลือก · ลูกศรเปลี่ยนค่า · Enter ไปช่องปริมาณ */}
            <NativeSelect
              ref={(el) => register("deduct", el)}
              id={`${id}-deduct`}
              value={entry.deduct_percent || NO_DEDUCT}
              onChange={(e) => actions.setLineEntry({ deduct_percent: e.target.value })}
              onKeyDown={onDeductKey}
              aria-invalid={!!deductError}
              aria-describedby={deductError ? `${id}-deduct-error` : undefined}
              className="tabular-nums"
            >
              {DEDUCT_CHOICES.map((percent) => (
                <NativeSelectOption key={percent} value={percent}>
                  {percent === NO_DEDUCT ? t("lines.deductNone") : t("lines.deductOption", { percent })}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldError id={`${id}-deduct-error`}>{deductError}</FieldError>
          </Field>

          <Field data-invalid={!!weightError}>
            <FieldLabel htmlFor={`${id}-weight`}>{t("lines.weight")}</FieldLabel>
            <Input
              ref={(el) => register("weight", el)}
              id={`${id}-weight`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder={t("lines.weightPlaceholder")}
              value={entry.weight_g}
              onChange={(e) => actions.setLineEntry({ weight_g: e.target.value })}
              onKeyDown={onWeightKey}
              aria-required="true"
              aria-invalid={!!weightError}
              aria-describedby={weightError ? `${id}-weight-error` : undefined}
              className="text-right tabular-nums"
            />
            <FieldError id={`${id}-weight-error`}>{weightError}</FieldError>
          </Field>

          {/* คีย์บอร์ดใช้ Enter ในช่องปริมาณ — ปุ่มนี้สำหรับเมาส์ จึงไม่อยู่ในลำดับ Tab */}
          <Button
            type="button"
            variant="outline"
            tabIndex={-1}
            // แถวเดียว: ระยะบน = ความสูงป้าย (text-sm × leading-snug) + gap-3 ของ Field → ตรงระดับกับช่องกรอก แม้มีข้อความผิดใต้ช่อง
            className="justify-self-start @4xl/lines:mt-[calc(0.875rem*1.375+0.75rem)]"
            onClick={() => void actions.addLine()}
          >
            {t("lines.add")}
            <Kbd>
              <CornerDownLeft aria-hidden="true" />
              {t("keys.enter")}
            </Kbd>
          </Button>
        </div>
        <FieldDescription id={`${id}-price-hint`} className="-mt-2">
          {t("lines.priceHint")}
        </FieldDescription>

        <LinesTable c={c} />

        <Field>
          <FieldLabel htmlFor={`${id}-detail`}>{t("lines.detail")}</FieldLabel>
          <Textarea
            ref={(el) => register("detail", el)}
            id={`${id}-detail`}
            rows={2}
            maxLength={2000}
            placeholder={t("lines.detailPlaceholder")}
            value={state.detail}
            onChange={(e) => actions.typeDetail(e.target.value)}
            onKeyDown={onDetailKey}
            aria-invalid={!!c.fieldError("detail")}
            aria-describedby={describedBy(`${id}-detail-hint`, c.fieldError("detail") && `${id}-detail-error`)}
          />
          <FieldDescription id={`${id}-detail-hint`}>{t("lines.detailHint")}</FieldDescription>
          <FieldError id={`${id}-detail-error`}>{c.fieldError("detail")}</FieldError>
        </Field>
      </CardContent>
    </Card>
  );
}

/** จำนวนคอลัมน์ของตาราง (# · รายการ · บริสุทธิ์ · หัก % · ปริมาณ · ราคา/กรัม · ก่อนหัก · เงินที่หัก · ราคารวม · ลบ) */
const COLUMNS = 10;
const cell = "px-2";
const num = "px-2 text-right tabular-nums";

/**
 * ตารางแถวที่เพิ่มแล้ว — ราคาทุกช่องมาจาก quote ของเซิร์ฟเวอร์ (ราคา/กรัม · ยอดก่อนหัก · เงินที่หัก · ราคารวม)
 * แสดงเฉพาะผลล่าสุด (ลบแถวแล้ว index เลื่อน ผลเก่าจะวางผิดแถว) — ระหว่างรอผลแสดง "…" · แถวที่คิดไม่ได้แสดง "–"
 */
function LinesTable({ c }: { c: BuyController }) {
  const { t } = useTranslation("buy");
  const { state, actions, quote, fresh, metals } = c;
  const errors = fresh && quote ? quote.errors : [];
  const nameOf = (metalId: string) => metals.find((m) => m.id === metalId)?.name_th ?? metalId;
  const stale = !fresh && "text-muted-foreground";
  const percent = (value: string) => t("lines.percent", { value: formatPercent(value) });

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table aria-busy={!fresh}>
        <TableCaption className="sr-only">{t("lines.table")}</TableCaption>
        <TableHeader className="bg-muted">
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className={cn(num, "w-8")}>
              {t("lines.colNo")}
            </TableHead>
            <TableHead scope="col" className={cell}>
              {t("lines.colItem")}
            </TableHead>
            <TableHead scope="col" className={num}>
              {t("lines.colPurity")}
            </TableHead>
            <TableHead scope="col" className={num}>
              {t("lines.colDeductPercent")}
            </TableHead>
            <TableHead scope="col" className={num}>
              {t("lines.colWeight")}
            </TableHead>
            <TableHead scope="col" className={num}>
              {t("lines.colUnitPrice")}
            </TableHead>
            <TableHead scope="col" className={num}>
              {t("lines.colGross")}
            </TableHead>
            <TableHead scope="col" className={num}>
              {t("lines.colDeductAmount")}
            </TableHead>
            <TableHead scope="col" className={num}>
              {t("lines.colAmount")}
            </TableHead>
            <TableHead scope="col" className={cn(cell, "w-10")}>
              <span className="sr-only">{t("lines.colRemove")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {state.lines.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={COLUMNS} className="h-16 px-3 text-center text-muted-foreground whitespace-normal">
                {t("lines.empty")}
              </TableCell>
            </TableRow>
          ) : (
            state.lines.map((line, i) => {
              const quoted = fresh ? quote?.lines.find((l) => l.index === i) : undefined;
              const problems = rowErrors(errors, "lines", i);
              // ยังไม่ได้ผลล่าสุด = รอ · ได้ผลแล้วแต่แถวนี้ไม่มีราคา (เช่น ยังไม่ได้ตั้งราคาของวัน) = ขีด
              const money = (value: string | undefined) =>
                value !== undefined ? formatMoney(value) : fresh ? t("lines.notPriced") : t("lines.pending");
              return (
                <LineRowView
                  key={line.key}
                  n={i + 1}
                  metal={nameOf(line.metal_id)}
                  purity={percent(quoted?.purity_percent ?? line.purity_percent)}
                  deduct={percent(quoted?.deduct_percent ?? line.deduct_percent)}
                  weight={formatWeight(quoted?.weight_g ?? line.weight_g)}
                  unitPrice={money(quoted?.unit_price)}
                  gross={money(quoted?.gross_amount)}
                  deductAmount={money(quoted?.deduct_amount)}
                  amount={money(quoted?.amount)}
                  problems={problems.map((p) => p.message)}
                  onRemove={() => actions.removeLine(line.key)}
                />
              );
            })
          )}
        </TableBody>
        {quote && state.lines.length > 0 && (
          <TableFooter>
            <TableRow className={cn("hover:bg-transparent", stale)}>
              <TableCell colSpan={4} className={cn(cell, "text-right")}>
                {t("lines.total")}
              </TableCell>
              <TableCell className={num}>{formatWeight(quote.total_weight)}</TableCell>
              <TableCell className={num}>
                <span className="sr-only">{t("lines.average")} </span>
                {formatMoney(quote.avg_price_per_g)}
                <span className="block text-xs font-normal text-muted-foreground" aria-hidden="true">
                  {t("lines.average")}
                </span>
              </TableCell>
              <TableCell />
              <TableCell />
              <TableCell className={cn(num, "text-base font-semibold")}>{formatMoney(quote.total_amount)}</TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}

function LineRowView(props: {
  n: number;
  metal: string;
  purity: string;
  deduct: string;
  weight: string;
  unitPrice: string;
  gross: string;
  deductAmount: string;
  amount: string;
  problems: string[];
  onRemove: () => void;
}) {
  const { t } = useTranslation("buy");
  const invalid = props.problems.length > 0;
  return (
    <>
      <TableRow aria-invalid={invalid || undefined} className={cn(invalid && "border-l-4 border-l-destructive")}>
        <TableCell className={num}>{props.n}</TableCell>
        <TableCell className={cell}>{props.metal}</TableCell>
        <TableCell className={num}>{props.purity}</TableCell>
        <TableCell className={num}>{props.deduct}</TableCell>
        <TableCell className={num}>{props.weight}</TableCell>
        <TableCell className={num}>{props.unitPrice}</TableCell>
        <TableCell className={num}>{props.gross}</TableCell>
        <TableCell className={num}>{props.deductAmount}</TableCell>
        <TableCell className={cn(num, "font-medium")}>{props.amount}</TableCell>
        <TableCell className={cell}>
          {/* ลบได้ทั้งเมาส์และคีย์บอร์ด (WCAG 2.1.1) — อยู่ในลำดับ Tab ท้ายแถวของตัวเอง */}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("lines.remove", { n: props.n })}
            onClick={props.onRemove}
          >
            <X aria-hidden="true" />
          </Button>
        </TableCell>
      </TableRow>
      {invalid && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={COLUMNS} className="px-3 pt-0 text-sm whitespace-normal text-destructive" role="alert">
            {t("lines.rowProblem", { n: props.n, problems: props.problems.join(" · ") })}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

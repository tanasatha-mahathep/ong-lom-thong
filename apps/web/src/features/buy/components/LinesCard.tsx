import { CornerDownLeft, X } from "lucide-react";
import { type KeyboardEvent, useId } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { formatMoney, formatWeight } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useTranslation } from "../i18n";
import { rowErrors } from "../model";
import type { BuyController } from "../use-buy-controller";
import { describedBy, isPlainEnter } from "./field-helpers";

/** ของเก่าที่รับซื้อ: เลือกโลหะ → ปริมาณ → ราคา → Enter เพิ่มแถว (API ตรวจแถวก่อนเพิ่ม) */
export function LinesCard({ c }: { c: BuyController }) {
  const { t } = useTranslation("buy");
  const id = useId();
  const { state, actions, register, metals, metalId } = c;
  const entry = state.lineEntry;
  const err = state.lineError;
  const errorOf = (field: "metal_id" | "weight_g" | "amount") => (err?.field === field ? err.message : undefined);
  const weightError = errorOf("weight_g");
  const amountError = errorOf("amount");
  const metalError = errorOf("metal_id");

  const escClears = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return false;
    e.preventDefault();
    actions.clearLineEntry();
    return true;
  };
  const onMetalKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (escClears(e) || !isPlainEnter(e)) return;
    e.preventDefault();
    actions.focusOn("weight");
  };
  const onWeightKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (escClears(e) || !isPlainEnter(e)) return;
    e.preventDefault();
    if (entry.weight_g.trim()) actions.focusOn("amount");
    else if (!entry.amount.trim() && state.lines.length > 0) actions.focusOn("detail");
    else void actions.addLine();
  };
  const onAmountKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (escClears(e) || !isPlainEnter(e)) return;
    e.preventDefault();
    void actions.addLine();
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
      <CardContent className="flex flex-col gap-4">
        <div className="grid items-start gap-4 lg:grid-cols-[1fr_11rem_13rem_auto]">
          <FieldSet className="gap-2" data-invalid={!!metalError}>
            <FieldLegend variant="label" className="mb-0">
              {t("lines.metal")}
            </FieldLegend>
            <RadioGroup
              ref={(el) => register("metal", el)}
              value={metalId}
              onValueChange={(value) => actions.setLineEntry({ metal_id: value })}
              onKeyDown={onMetalKey}
              className="flex flex-wrap gap-2"
              aria-describedby={metalError ? `${id}-metal-error` : undefined}
            >
              {metals.map((m) => (
                <Label
                  key={m.id}
                  htmlFor={`${id}-metal-${m.code}`}
                  className="flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
                >
                  <RadioGroupItem
                    id={`${id}-metal-${m.code}`}
                    value={m.id}
                    // ลูกศรย้ายโฟกัส = เลือกด้วย (แบบ radio ปกติ) — ไม่พึ่งจังหวะปล่อยปุ่มของ Radix
                    onFocus={() => m.id !== metalId && actions.setLineEntry({ metal_id: m.id })}
                  />
                  {m.name_th}
                </Label>
              ))}
            </RadioGroup>
            <FieldError id={`${id}-metal-error`}>{metalError}</FieldError>
          </FieldSet>

          <Field data-invalid={!!weightError}>
            <FieldLabel htmlFor={`${id}-weight`}>{t("lines.weight")}</FieldLabel>
            <Input
              ref={(el) => register("weight", el)}
              id={`${id}-weight`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={entry.weight_g}
              onChange={(e) => actions.setLineEntry({ weight_g: e.target.value })}
              onKeyDown={onWeightKey}
              aria-invalid={!!weightError}
              aria-describedby={weightError ? `${id}-weight-error` : undefined}
              className="text-right tabular-nums"
            />
            <FieldError id={`${id}-weight-error`}>{weightError}</FieldError>
          </Field>

          <Field data-invalid={!!amountError}>
            <FieldLabel htmlFor={`${id}-amount`}>{t("lines.amount")}</FieldLabel>
            <Input
              ref={(el) => register("amount", el)}
              id={`${id}-amount`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={entry.amount}
              onChange={(e) => actions.setLineEntry({ amount: e.target.value })}
              onKeyDown={onAmountKey}
              aria-invalid={!!amountError}
              aria-describedby={amountError ? `${id}-amount-error` : undefined}
              className="text-right tabular-nums"
            />
            <FieldError id={`${id}-amount-error`}>{amountError}</FieldError>
          </Field>

          {/* คีย์บอร์ดใช้ Enter ในช่องราคา — ปุ่มนี้สำหรับเมาส์ จึงไม่อยู่ในลำดับ Tab */}
          <Button
            type="button"
            variant="secondary"
            tabIndex={-1}
            className="lg:mt-[1.375rem]"
            onClick={() => void actions.addLine()}
          >
            {t("lines.add")}
            <Kbd>
              <CornerDownLeft aria-hidden="true" />
              {t("keys.enter")}
            </Kbd>
          </Button>
        </div>

        <LinesTable c={c} />

        <Field>
          <FieldLabel htmlFor={`${id}-detail`}>{t("lines.detail")}</FieldLabel>
          <Textarea
            ref={(el) => register("detail", el)}
            id={`${id}-detail`}
            rows={2}
            maxLength={2000}
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

/**
 * ตารางแถวที่เพิ่มแล้ว — ปริมาณ/ราคารวมคือค่าที่กรอก · ราคาต่อหน่วยและยอดรวมมาจาก quote
 * ราคาต่อหน่วยและ error ต่อแถวแสดงเฉพาะผลล่าสุด (ลบแถวแล้ว index เลื่อน ผลเก่าจะวางผิดแถว)
 */
function LinesTable({ c }: { c: BuyController }) {
  const { t } = useTranslation("buy");
  const { state, actions, quote, fresh, metals } = c;
  const errors = fresh && quote ? quote.errors : [];
  const nameOf = (metalId: string) => metals.find((m) => m.id === metalId)?.name_th ?? metalId;
  const stale = !fresh && "text-muted-foreground";

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table aria-busy={!fresh}>
        <TableCaption className="sr-only">{t("lines.table")}</TableCaption>
        <TableHeader className="bg-muted">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10 px-3 text-right">{t("lines.colNo")}</TableHead>
            <TableHead className="px-3">{t("lines.colItem")}</TableHead>
            <TableHead className="px-3 text-right">{t("lines.colWeight")}</TableHead>
            <TableHead className="px-3">{t("lines.colUnit")}</TableHead>
            <TableHead className="px-3 text-right">{t("lines.colUnitPrice")}</TableHead>
            <TableHead className="px-3 text-right">{t("lines.colAmount")}</TableHead>
            <TableHead className="w-12 px-3">
              <span className="sr-only">{t("lines.colRemove")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {state.lines.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={7} className="h-16 px-3 text-center text-muted-foreground whitespace-normal">
                {t("lines.empty")}
              </TableCell>
            </TableRow>
          ) : (
            state.lines.map((line, i) => {
              const quoted = fresh ? quote?.lines.find((l) => l.index === i) : undefined;
              const problems = rowErrors(errors, "lines", i);
              return (
                <LineRowView
                  key={line.key}
                  n={i + 1}
                  metal={nameOf(line.metal_id)}
                  weight={formatWeight(quoted?.weight_g ?? line.weight_g)}
                  unitPrice={quoted ? formatMoney(quoted.price_per_g) : t("lines.pending")}
                  amount={formatMoney(quoted?.amount ?? line.amount)}
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
              <TableCell colSpan={2} className="px-3 text-right">
                {t("lines.total")}
              </TableCell>
              <TableCell className="px-3 text-right tabular-nums">{formatWeight(quote.total_weight)}</TableCell>
              <TableCell className="px-3">{t("lines.unit")}</TableCell>
              <TableCell className="px-3 text-right tabular-nums">
                <span className="sr-only">{t("lines.average")} </span>
                {formatMoney(quote.avg_price_per_g)}
                <span className="ml-1 text-xs text-muted-foreground" aria-hidden="true">
                  {t("lines.average")}
                </span>
              </TableCell>
              <TableCell className="px-3 text-right text-base font-semibold tabular-nums">
                {formatMoney(quote.total_amount)}
              </TableCell>
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
  weight: string;
  unitPrice: string;
  amount: string;
  problems: string[];
  onRemove: () => void;
}) {
  const { t } = useTranslation("buy");
  const invalid = props.problems.length > 0;
  return (
    <>
      <TableRow aria-invalid={invalid || undefined} className={cn(invalid && "border-l-4 border-l-destructive")}>
        <TableCell className="px-3 text-right tabular-nums">{props.n}</TableCell>
        <TableCell className="px-3">{props.metal}</TableCell>
        <TableCell className="px-3 text-right tabular-nums">{props.weight}</TableCell>
        <TableCell className="px-3">{t("lines.unit")}</TableCell>
        <TableCell className="px-3 text-right tabular-nums">{props.unitPrice}</TableCell>
        <TableCell className="px-3 text-right tabular-nums">{props.amount}</TableCell>
        <TableCell className="px-3">
          {/* ลบด้วยเมาส์ (แบบ X ของระบบเดิม) — ไม่อยู่ในลำดับ Tab */}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            tabIndex={-1}
            aria-label={t("lines.remove", { n: props.n })}
            onClick={props.onRemove}
          >
            <X aria-hidden="true" />
          </Button>
        </TableCell>
      </TableRow>
      {invalid && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={7} className="px-3 pt-0 text-sm whitespace-normal text-destructive" role="alert">
            {t("lines.rowProblem", { n: props.n, problems: props.problems.join(" · ") })}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

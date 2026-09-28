import { PAYMENT_METHODS } from "@ong/core";
import { CircleAlert, CircleCheck, LoaderCircle, X } from "lucide-react";
import { type KeyboardEvent, useId } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useBuyT } from "../i18n";
import { type PaymentMethod, balanceView, isNegativeMoney, isZeroMoney, rowErrors } from "../model";
import type { BuyController } from "../use-buy-controller";
import { isPlainEnter } from "./field-helpers";

const METHODS = Object.keys(PAYMENT_METHODS) as PaymentMethod[];
const isMethod = (v: string): v is PaymentMethod => (METHODS as string[]).includes(v);

const TONE: Record<ReturnType<typeof balanceView>["tone"], string> = {
  stale: "text-muted-foreground",
  due: "text-destructive",
  over: "text-destructive",
  balanced: "text-foreground",
};

/** ชำระเงิน: วิธี (เงินสด/โอนเงิน+ธนาคาร) → จำนวนเงิน → Enter · "เต็มจำนวน" ใช้ยอดคงเหลือจาก API */
export function PaymentsCard({ c }: { c: BuyController }) {
  const t = useBuyT();
  const id = useId();
  const { state, actions, register, quote, fresh } = c;
  const entry = state.paymentEntry;
  const err = state.paymentError;
  const errorOf = (field: "method" | "bank" | "amount") => (err?.field === field ? err.message : undefined);
  const methodError = errorOf("method");
  const bankError = errorOf("bank");
  const amountError = errorOf("amount");
  const balance = balanceView(quote, fresh, state.payments.length > 0, t);
  const balanceLeft = fresh && quote && !isZeroMoney(quote.balance) && !isNegativeMoney(quote.balance);

  const escClears = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return false;
    e.preventDefault();
    actions.clearPaymentEntry();
    return true;
  };
  const onMethodKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (escClears(e) || !isPlainEnter(e)) return;
    e.preventDefault();
    actions.focusOn(entry.method === "transfer" ? "bank" : "paymentAmount");
  };
  const onBankKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (escClears(e) || !isPlainEnter(e)) return;
    e.preventDefault();
    actions.focusOn("paymentAmount");
  };
  const onAmountKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (escClears(e) || !isPlainEnter(e)) return;
    e.preventDefault();
    void actions.addPayment();
  };

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base">{t("cards.payments")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p
          className={cn("flex items-center gap-2 text-xl font-semibold", TONE[balance.tone])}
          role="status"
          aria-live="polite"
        >
          {balance.tone === "balanced" ? (
            <CircleCheck className="size-6 shrink-0" aria-hidden="true" />
          ) : balance.tone === "stale" ? (
            <LoaderCircle className="size-6 shrink-0 animate-spin" aria-hidden="true" />
          ) : (
            <CircleAlert className="size-6 shrink-0" aria-hidden="true" />
          )}
          {balance.text}
        </p>

        <div className="grid items-start gap-4 md:grid-cols-[auto_12rem_13rem_auto]">
          <FieldSet className="gap-2" data-invalid={!!methodError}>
            <FieldLegend variant="label" className="mb-0">
              {t("payments.method")}
            </FieldLegend>
            <RadioGroup
              ref={(el) => register("paymentMethod", el)}
              value={entry.method}
              onValueChange={(value) => {
                if (isMethod(value)) actions.setPaymentEntry({ method: value });
              }}
              onKeyDown={onMethodKey}
              className="flex gap-2"
              aria-describedby={methodError ? `${id}-method-error` : undefined}
            >
              {METHODS.map((m) => (
                <Label
                  key={m}
                  htmlFor={`${id}-method-${m}`}
                  className="flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
                >
                  <RadioGroupItem
                    id={`${id}-method-${m}`}
                    value={m}
                    onFocus={() => m !== entry.method && actions.setPaymentEntry({ method: m })}
                  />
                  {PAYMENT_METHODS[m]}
                </Label>
              ))}
            </RadioGroup>
            <FieldError id={`${id}-method-error`}>{methodError}</FieldError>
          </FieldSet>

          {entry.method === "transfer" ? (
            <Field data-invalid={!!bankError}>
              <FieldLabel htmlFor={`${id}-bank`}>{t("payments.bank")}</FieldLabel>
              <Input
                ref={(el) => register("bank", el)}
                id={`${id}-bank`}
                type="text"
                autoComplete="off"
                maxLength={100}
                required
                placeholder={t("payments.bankPlaceholder")}
                value={entry.bank}
                onChange={(e) => actions.setPaymentEntry({ bank: e.target.value })}
                onKeyDown={onBankKey}
                aria-invalid={!!bankError}
                aria-describedby={bankError ? `${id}-bank-error` : undefined}
              />
              <FieldError id={`${id}-bank-error`}>{bankError}</FieldError>
            </Field>
          ) : (
            <div className="hidden md:block" aria-hidden="true" />
          )}

          <Field data-invalid={!!amountError}>
            <FieldLabel htmlFor={`${id}-amount`}>{t("payments.amount")}</FieldLabel>
            <Input
              ref={(el) => register("paymentAmount", el)}
              id={`${id}-amount`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={entry.amount}
              onChange={(e) => actions.setPaymentEntry({ amount: e.target.value })}
              onKeyDown={onAmountKey}
              aria-invalid={!!amountError}
              aria-describedby={amountError ? `${id}-amount-error` : undefined}
              className="text-right tabular-nums"
            />
            <FieldError id={`${id}-amount-error`}>{amountError}</FieldError>
          </Field>

          <div className="flex gap-2 md:mt-[1.375rem]">
            {/* คีย์บอร์ดใช้ Enter ในช่องจำนวนเงิน — ปุ่มนี้สำหรับเมาส์ */}
            <Button type="button" variant="secondary" tabIndex={-1} onClick={() => void actions.addPayment()}>
              {t("payments.add")}
            </Button>
            <Button
              type="button"
              variant="outline"
              aria-disabled={!balanceLeft}
              className="aria-disabled:opacity-50"
              onClick={() => void actions.payFull()}
            >
              {t("payments.payFull")}
            </Button>
          </div>
        </div>

        <PaymentsTable c={c} />
      </CardContent>
    </Card>
  );
}

function PaymentsTable({ c }: { c: BuyController }) {
  const t = useBuyT();
  const { state, actions, quote, fresh } = c;
  const errors = fresh && quote ? quote.errors : [];
  if (state.payments.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("payments.empty")}</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table aria-busy={!fresh}>
        <TableCaption className="sr-only">{t("payments.table")}</TableCaption>
        <TableHeader className="bg-muted">
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-3">{t("payments.colMethod")}</TableHead>
            <TableHead className="px-3">{t("payments.colBank")}</TableHead>
            <TableHead className="px-3 text-right">{t("payments.colAmount")}</TableHead>
            <TableHead className="w-12 px-3">
              <span className="sr-only">{t("payments.colRemove")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {state.payments.map((p, i) => {
            const problems = rowErrors(errors, "payments", i).map((e) => e.message);
            return (
              <PaymentRowView
                key={p.key}
                n={i + 1}
                method={PAYMENT_METHODS[p.method]}
                bank={p.method === "transfer" ? p.bank : t("payments.noBank")}
                amount={formatMoney(p.amount)}
                problems={problems}
                onRemove={() => actions.removePayment(p.key)}
              />
            );
          })}
        </TableBody>
        {quote && (
          <TableFooter>
            <TableRow className={cn("hover:bg-transparent", !fresh && "opacity-60")}>
              <TableCell colSpan={2} className="px-3 text-right">
                {t("payments.total")}
              </TableCell>
              <TableCell className="px-3 text-right text-base font-semibold tabular-nums">
                {formatMoney(quote.paid)}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}

function PaymentRowView(props: {
  n: number;
  method: string;
  bank: string;
  amount: string;
  problems: string[];
  onRemove: () => void;
}) {
  const t = useBuyT();
  const invalid = props.problems.length > 0;
  return (
    <>
      <TableRow aria-invalid={invalid || undefined} className={cn(invalid && "border-l-4 border-l-destructive")}>
        <TableCell className="px-3">{props.method}</TableCell>
        <TableCell className="px-3">{props.bank}</TableCell>
        <TableCell className="px-3 text-right tabular-nums">{props.amount}</TableCell>
        <TableCell className="px-3">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            tabIndex={-1}
            aria-label={t("payments.remove", { n: props.n })}
            onClick={props.onRemove}
          >
            <X aria-hidden="true" />
          </Button>
        </TableCell>
      </TableRow>
      {invalid && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={4} className="px-3 pt-0 text-sm whitespace-normal text-destructive" role="alert">
            {props.problems.join(" · ")}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

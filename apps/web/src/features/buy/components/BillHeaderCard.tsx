import { Link } from "@tanstack/react-router";
import { CircleAlert } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useId } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatBoardPrice, formatThaiDate } from "@/lib/format";
import { canSetGoldPrice } from "@/lib/nav";
import { useBuyT } from "../i18n";
import type { BuyController } from "../use-buy-controller";
import { describedBy, isPlainEnter } from "./field-helpers";

/** หัวบิล: วันที่ · เวลา · ราคาทองแท่งขายออกของวันบิล · สาขา — แก้ไม่ได้ ยกเว้นบิลย้อนหลัง (ผู้จัดการขึ้นไป) */
export function BillHeaderCard({ c }: { c: BuyController }) {
  const t = useBuyT();
  const id = useId();
  const { quote, state } = c;
  const goldPriceError = c.fieldError("gold_price");
  const backdate = state.backdate;

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base">{t("cards.header")}</h2>
        </CardTitle>
        {c.canBackdate && (
          <CardAction className="flex items-center gap-2">
            <Switch
              id={`${id}-backdate`}
              checked={backdate.enabled}
              onCheckedChange={c.actions.toggleBackdate}
              aria-describedby={`${id}-backdate-hint`}
            />
            <Label htmlFor={`${id}-backdate`} className="cursor-pointer py-1">
              {t("backdate.toggle")}
            </Label>
            <span id={`${id}-backdate-hint`} className="sr-only">
              {t("backdate.toggleHint")}
            </span>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
          <HeaderItem label={t("header.date")}>{quote ? formatThaiDate(quote.date, "long") : null}</HeaderItem>
          <HeaderItem label={t("header.time")}>
            {backdate.enabled && backdate.timeText ? backdate.timeText : t("header.timeAuto")}
          </HeaderItem>
          <HeaderItem label={t("header.goldPrice")} hint={t("header.goldPriceHint")}>
            {quote ? <span className="tabular-nums">{formatBoardPrice(quote.gold_price_snapshot)}</span> : null}
          </HeaderItem>
          <HeaderItem label={t("header.branch")}>{quote?.branch.name ?? c.me.branch?.name ?? null}</HeaderItem>
        </dl>

        {backdate.enabled && <BackdateFields c={c} />}

        {c.branchSetupError && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>{c.branchSetupError}</AlertTitle>
          </Alert>
        )}

        {goldPriceError && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>{goldPriceError}</AlertTitle>
            <AlertDescription>
              {canSetGoldPrice(c.me.role) ? (
                <Link to="/settings/gold-price" className="font-medium underline underline-offset-4">
                  {t("header.goldPriceLink")}
                </Link>
              ) : (
                t("header.goldPriceStaff")
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function HeaderItem({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{children ?? <Skeleton className="h-5 w-24" />}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

/** วันที่ (พ.ศ. แบบพิมพ์ ห้าม date picker) · เวลา · เหตุผล — ยืนยันวันที่ตอนออกจากช่องหรือกด Enter */
function BackdateFields({ c }: { c: BuyController }) {
  const t = useBuyT();
  const id = useId();
  const b = c.state.backdate;
  const { register, actions } = c;
  const dateError = b.dateError ? t(`backdate.errors.${b.dateError}`) : c.fieldError("date");
  const timeError = b.timeError ? t(`backdate.errors.${b.timeError}`) : c.fieldError("time");
  const reasonError = c.fieldError("backdate_reason");

  const onDateKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!isPlainEnter(e)) return;
    e.preventDefault();
    actions.commitBackdateDate();
    actions.focusOn("backdateTime");
  };
  const onTimeKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!isPlainEnter(e)) return;
    e.preventDefault();
    actions.commitBackdateTime();
    actions.focusOn("backdateReason");
  };
  const onReasonKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isPlainEnter(e)) return;
    e.preventDefault();
    actions.focusOn("idBox");
  };

  return (
    <div className="grid gap-4 rounded-lg border border-dashed p-4 md:grid-cols-[12rem_8rem_1fr]">
      <Field data-invalid={!!dateError}>
        <FieldLabel htmlFor={`${id}-date`}>{t("backdate.date")}</FieldLabel>
        <Input
          ref={(el) => register("backdateDate", el)}
          id={`${id}-date`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={t("backdate.datePlaceholder")}
          value={b.dateText}
          onChange={(e) => actions.typeBackdateDate(e.target.value)}
          onBlur={actions.commitBackdateDate}
          onKeyDown={onDateKey}
          aria-invalid={!!dateError}
          aria-describedby={describedBy(`${id}-date-hint`, dateError && `${id}-date-error`)}
          className="tabular-nums"
        />
        <FieldDescription id={`${id}-date-hint`}>{t("backdate.dateHint")}</FieldDescription>
        <FieldError id={`${id}-date-error`}>{dateError}</FieldError>
      </Field>
      <Field data-invalid={!!timeError}>
        <FieldLabel htmlFor={`${id}-time`}>{t("backdate.time")}</FieldLabel>
        <Input
          ref={(el) => register("backdateTime", el)}
          id={`${id}-time`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={t("backdate.timePlaceholder")}
          value={b.timeText}
          onChange={(e) => actions.typeBackdateTime(e.target.value)}
          onBlur={actions.commitBackdateTime}
          onKeyDown={onTimeKey}
          aria-invalid={!!timeError}
          aria-describedby={describedBy(`${id}-time-hint`, timeError && `${id}-time-error`)}
          className="tabular-nums"
        />
        <FieldDescription id={`${id}-time-hint`}>{t("backdate.timeHint")}</FieldDescription>
        <FieldError id={`${id}-time-error`}>{timeError}</FieldError>
      </Field>
      <Field data-invalid={!!reasonError}>
        <FieldLabel htmlFor={`${id}-reason`}>{t("backdate.reason")}</FieldLabel>
        <Textarea
          ref={(el) => register("backdateReason", el)}
          id={`${id}-reason`}
          rows={2}
          maxLength={500}
          required
          value={b.reason}
          onChange={(e) => actions.typeBackdateReason(e.target.value)}
          onKeyDown={onReasonKey}
          aria-invalid={!!reasonError}
          aria-describedby={describedBy(`${id}-reason-hint`, reasonError && `${id}-reason-error`)}
        />
        <FieldDescription id={`${id}-reason-hint`}>{t("backdate.reasonHint")}</FieldDescription>
        <FieldError id={`${id}-reason-error`}>{reasonError}</FieldError>
      </Field>
    </div>
  );
}

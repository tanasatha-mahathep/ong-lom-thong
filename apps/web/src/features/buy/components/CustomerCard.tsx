import { CircleAlert, ExternalLink, UserPlus, UserRoundPen } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useId } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useTranslation } from "../i18n";
import type { BuyController } from "../use-buy-controller";
import { useSiamIdCapture } from "../use-siam-id-capture";
import { CustomerSearch } from "./CustomerSearch";
import { describedBy, isPlainEnter } from "./field-helpers";

/** เปิดในแท็บใหม่ — กลับมาหน้านี้แล้วระบบค้น/ตรวจบัตรให้ใหม่เอง (focus · BroadcastChannel) */
const NEW_CUSTOMER_HREF = "/customers/new?from=buy";
const editCustomerHref = (id: string) => `/customers/${id}?mode=edit&from=buy`;

export function CustomerCard({ c }: { c: BuyController }) {
  const { t } = useTranslation("buy");
  const { state, register } = c;

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base">{t("cards.customer")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* ลำดับ DOM = ลำดับ Tab: เลขบัตร → ค้นหา → ลูกค้าใหม่ */}
        <div className="grid items-start gap-4 md:grid-cols-[16rem_1fr_auto]">
          <NationalIdBox c={c} />
          <CustomerSearch c={c} />
          <Button asChild variant="outline" className="md:mt-[1.375rem]">
            <a ref={(el) => register("newCustomer", el)} href={NEW_CUSTOMER_HREF} target="_blank" rel="noopener">
              <UserPlus aria-hidden="true" />
              {t("customer.newCustomer")}
              <span className="sr-only">{t("customer.opensInNewTab")}</span>
            </a>
          </Button>
        </div>

        {state.lookup === "notFound" && (
          <Alert>
            <CircleAlert aria-hidden="true" />
            <AlertDescription className="text-foreground">{t("customer.notFound")}</AlertDescription>
          </Alert>
        )}

        {state.customer ? (
          <CustomerSummary c={c} />
        ) : (
          <p className="text-sm text-muted-foreground">{t("customer.none")}</p>
        )}
      </CardContent>
    </Card>
  );
}

/** ช่องเลขบัตร — โฟกัสเมื่อเปิดหน้า (autofocus แบบระบบเดิม) · เสียบบัตร Siam ID แล้วค้นให้เอง */
function NationalIdBox({ c }: { c: BuyController }) {
  const { t } = useTranslation("buy");
  const id = useId();
  const { state, actions, register } = c;
  const capture = useSiamIdCapture({
    value: state.idText,
    onValueChange: actions.typeId,
    onNationalId: actions.findByNationalId,
  });
  const error =
    state.lookup === "badChecksum"
      ? t("customer.badChecksum")
      : state.lookup === "failed"
        ? t("customer.searchFailed")
        : undefined;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    capture.inputProps.onKeyDown(e);
    if (e.defaultPrevented) return;
    if (e.key === "Escape") {
      capture.cancel();
      actions.typeId("");
      return;
    }
    if (isPlainEnter(e)) {
      e.preventDefault();
      const digits = state.idText.replace(/\D/g, "");
      if (digits.length === 13) void actions.findByNationalId(digits).then((next) => next?.());
    }
  };

  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={`${id}-nid`}>{t("customer.idLabel")}</FieldLabel>
      <Input
        ref={(el) => register("idBox", el)}
        id={`${id}-nid`}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        // หน้าร้านเริ่มที่ช่องนี้เสมอ (ระบบเดิม id_card autofocus) — เสียบบัตรได้ทันทีที่เปิดหน้า
        autoFocus
        value={capture.inputProps.value}
        onChange={capture.inputProps.onChange}
        onKeyDown={onKeyDown}
        aria-invalid={!!error}
        aria-describedby={describedBy(`${id}-nid-hint`, error && `${id}-nid-error`)}
        className="tabular-nums"
      />
      <FieldDescription id={`${id}-nid-hint`} aria-live="polite">
        {state.lookup === "searching" ? t("customer.searching") : t("customer.idHint")}
      </FieldDescription>
      <FieldError id={`${id}-nid-error`}>{error}</FieldError>
    </Field>
  );
}

/** ลูกค้าที่เลือก — เลขบัตรมาสก์เสมอ (R13) · บัตรใช้ไม่ได้ = บล็อกการบันทึก แต่ไม่ล้างลูกค้า (แก้บัตรแล้วกลับมาได้) */
function CustomerSummary({ c }: { c: BuyController }) {
  const { t } = useTranslation("buy");
  const { state, register, actions, customerBlock, cardStatus } = c;
  const customer = state.customer;
  if (!customer) return null;
  const status = cardStatus ?? customer.card_status;

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-x-6 gap-y-2 rounded-lg border bg-muted/40 p-4 sm:grid-cols-2">
        <SummaryItem label={t("customer.name")}>
          <span className="text-base font-semibold">{customer.name_th}</span>
        </SummaryItem>
        <SummaryItem label={t("customer.nationalId")}>
          <span className="tabular-nums">{customer.national_id_masked}</span>
        </SummaryItem>
        <SummaryItem label={t("customer.address")}>{customer.address || t("customer.notProvided")}</SummaryItem>
        <SummaryItem label={t("customer.mobile")}>
          <span className="tabular-nums">{customer.mobile || t("customer.notProvided")}</span>
        </SummaryItem>
        <SummaryItem label={t("customer.card")}>
          <Badge variant={status === "ok" ? "secondary" : "destructive"}>{t(`customer.cardBadge.${status}`)}</Badge>
        </SummaryItem>
      </dl>

      {customerBlock && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{t("customer.blockedTitle")}</AlertTitle>
          <AlertDescription>{t("customer.blockedBody", { reason: customerBlock })}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild variant={customerBlock ? "destructive" : "outline"}>
          <a
            ref={(el) => register("editCustomer", el)}
            href={editCustomerHref(customer.id)}
            target="_blank"
            rel="noopener"
          >
            <UserRoundPen aria-hidden="true" />
            {t("customer.edit")}
            <ExternalLink aria-hidden="true" />
            <span className="sr-only">{t("customer.opensInNewTab")}</span>
          </a>
        </Button>
        <Button type="button" variant="outline" onClick={actions.changeCustomer}>
          {t("customer.change")}
        </Button>
      </div>
    </div>
  );
}

function SummaryItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

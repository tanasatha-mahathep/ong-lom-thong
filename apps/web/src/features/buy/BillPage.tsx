import { Receipt } from "@ong/core/receipt";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  CircleAlert,
  CircleCheck,
  Download,
  ExternalLink,
  FileText,
  HandCoins,
  IdCard,
  LoaderCircle,
  Printer,
  RefreshCw,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, errorMessage } from "@/lib/api";
import { formatBoardPrice, formatMoney, formatThaiDate, formatWeight } from "@/lib/format";
import { hasOpenLayer } from "@/lib/hotkeys";
import { canCreateBill } from "@/lib/nav";
import { type Role, useMe } from "@/lib/queries";
import { type Bill, PDF_POLL_WINDOW_MS, billKeys, billQuery, isFilePending, retryPdf, voidBill } from "./bill-api";
import { useTranslation } from "./i18n";
import { buyKeys } from "./queries";
import { autoPrintEnabled, setAutoPrint } from "./receipt/auto-print";
import { PrintPortal } from "./receipt/PrintPortal";
import { ReceiptErrorBoundary } from "./receipt/ReceiptErrorBoundary";
import { toReceiptData } from "./receipt/to-receipt-data";

const RETRY_ROLES: readonly Role[] = ["manager", "admin"];
const IDCARD_ROLES: readonly Role[] = ["accounting", "admin"];
const FAILED = new Set(["failed", "invalid"]);

/** ใบรับซื้อที่บันทึกแล้ว (/buy/$id) — ใบบนจอ + พิมพ์ (A4) + สถานะ PDF เก็บถาวร · ?print=true พิมพ์ทันทีหนึ่งครั้ง */
export function BillPage({ id, autoPrint }: { id: string; autoPrint: boolean }) {
  const { t } = useTranslation("buy");
  const { data: bill } = useSuspenseQuery(billQuery(id));
  if (!bill) {
    return (
      <>
        <PageHeader back="/bills" />
        <Alert>
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{t("bill.notFound")}</AlertTitle>
          <AlertDescription>
            <Link to="/bills" className="font-medium text-foreground underline underline-offset-4">
              {t("bill.toBills")}
            </Link>
          </AlertDescription>
        </Alert>
      </>
    );
  }
  return <BillView bill={bill} autoPrint={autoPrint} />;
}

function BillView({ bill, autoPrint }: { bill: Bill; autoPrint: boolean }) {
  const { t } = useTranslation("buy");
  const me = useMe();
  const navigate = useNavigate();
  const receipt = toReceiptData(bill);
  const printed = useRef(false);
  const receiptBroken = useRef(false);
  const newBill = useRef<HTMLAnchorElement>(null);

  // หลังบันทึก: โฟกัสอยู่ที่ "ซื้อเข้าบิลใหม่" — Enter ครั้งเดียวเริ่มบิลถัดไป
  // มีชั้นเปิดทับอยู่ (เช่น เปิดบิลจากหน้าค้นหาแล้วกด Ctrl+K ค้นต่อระหว่างบิลโหลด) = ไม่แย่งโฟกัสจากชั้นนั้น
  useEffect(() => {
    if (!hasOpenLayer()) newBill.current?.focus();
  }, []);

  // หลังบันทึก: พิมพ์หนึ่งครั้ง (รอฟอนต์ไทยก่อน) แล้วเอา ?print ออกจาก URL — กดย้อนกลับ/รีเฟรชไม่พิมพ์ซ้ำ
  // ใบพังต้องไม่พิมพ์ (พิมพ์กระดาษเปล่า/ข้อความ error) — <ReceiptErrorBoundary onError> ทำงานก่อน effect นี้เสมอ
  useEffect(() => {
    if (!autoPrint || printed.current || receiptBroken.current) return;
    printed.current = true;
    void navigate({ to: ".", search: {}, replace: true });
    const fontsReady = "fonts" in document ? document.fonts.ready : Promise.resolve();
    void fontsReady.then(() => window.print());
  }, [autoPrint, navigate]);

  const receiptError = (message: string) => (
    <Alert variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>{t("bill.receiptError", { message })}</AlertTitle>
    </Alert>
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <PageHeader
        back="/bills"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold text-foreground">{t("bill.title", { docNo: bill.doc_no })}</span>
            <span>{formatThaiDate(bill.date, "long")}</span>
            <span className="tabular-nums">{bill.time}</span>
            <span>{bill.branch.name}</span>
            {bill.status === "void" && <Badge variant="destructive">{t("bill.voidBadge")}</Badge>}
          </span>
        }
        actions={
          canCreateBill(me.role) && (
            <Button asChild>
              <Link ref={newBill} to="/buy">
                <HandCoins aria-hidden="true" />
                {t("bill.newBill")}
              </Link>
            </Button>
          )
        }
      />

      {bill.status === "void" && bill.void_reason && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{t("bill.voidReason", { reason: bill.void_reason })}</AlertTitle>
        </Alert>
      )}

      <p className="text-sm text-muted-foreground tabular-nums">
        {t("bill.meta", {
          weight: formatWeight(bill.total_weight),
          avg: formatMoney(bill.avg_price_per_g),
          price: formatBoardPrice(bill.gold_price_snapshot),
          name: bill.created_by.name,
        })}
      </p>

      <BillActions bill={bill} role={me.role} />

      <section
        aria-label={t("bill.receiptLabel")}
        className="theme-light overflow-x-auto rounded-xl border bg-card p-4 md:p-8"
      >
        <ReceiptErrorBoundary
          fallback={receiptError}
          onError={() => {
            receiptBroken.current = true;
          }}
        >
          <Receipt data={receipt} />
        </ReceiptErrorBoundary>
      </section>

      <PrintPortal>
        <ReceiptErrorBoundary
          fallback={() => null}
          onError={() => {
            receiptBroken.current = true;
          }}
        >
          <Receipt data={receipt} />
        </ReceiptErrorBoundary>
      </PrintPortal>
    </div>
  );
}

/** พิมพ์ · PDF (เปิด/ดาวน์โหลด/สร้างใหม่) · สำเนาบัตร · ยกเลิกบิล · ตั้งค่าพิมพ์อัตโนมัติ — ปุ่มตามสิทธิ์และสถานะไฟล์ */
function BillActions({ bill, role }: { bill: Bill; role: Role }) {
  const { t } = useTranslation("buy");
  const qc = useQueryClient();
  const [autoPrint, setAutoPrintState] = useState(autoPrintEnabled);
  const pdfUrl = `/api/buy/${encodeURIComponent(bill.id)}/pdf`;
  const idcardUrl = `/api/buy/${encodeURIComponent(bill.id)}/idcard`;
  const canRetry =
    RETRY_ROLES.includes(role) &&
    [bill.pdf_status, bill.idcard_status, bill.void_pdf_status].some((s) => FAILED.has(s));
  const isVoid = bill.status === "void";

  const retry = useMutation({
    mutationFn: () => retryPdf(bill.id),
    onSuccess: async () => {
      toast.success(t("bill.retryStarted"));
      await qc.invalidateQueries({ queryKey: billKeys.detail(bill.id) });
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError && e.status === 404
          ? t("bill.retryUnavailable")
          : t("bill.retryFailed", { error: errorMessage(e) }),
      ),
  });

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => window.print()}>
          <Printer aria-hidden="true" />
          {t("bill.print")}
          <KbdGroup className="max-sm:hidden">
            <Kbd>{t("keys.ctrl")}</Kbd>
            <Kbd>{t("keys.p")}</Kbd>
          </KbdGroup>
        </Button>
        {isVoid && bill.void_pdf_status === "ready" && (
          <Button asChild variant="outline">
            <a href={`${pdfUrl}?version=void`} target="_blank" rel="noopener">
              <FileText aria-hidden="true" />
              {t("bill.openVoidPdf")}
              <span className="sr-only">{t("bill.opensInNewTab")}</span>
            </a>
          </Button>
        )}
        {bill.pdf_status === "ready" && (
          <>
            <Button asChild variant="outline">
              <a href={isVoid ? `${pdfUrl}?version=original` : pdfUrl} target="_blank" rel="noopener">
                <FileText aria-hidden="true" />
                {isVoid ? t("bill.openOriginalPdf") : t("bill.openPdf")}
                <span className="sr-only">{t("bill.opensInNewTab")}</span>
              </a>
            </Button>
            {!isVoid && (
              <Button asChild variant="outline">
                <a href={pdfUrl} download={`${bill.doc_no}.pdf`}>
                  <Download aria-hidden="true" />
                  {t("bill.downloadPdf")}
                </a>
              </Button>
            )}
          </>
        )}
        {canRetry && (
          <Button type="button" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate()}>
            <RefreshCw className={retry.isPending ? "animate-spin" : undefined} aria-hidden="true" />
            {t("bill.retryPdf")}
          </Button>
        )}
        {IDCARD_ROLES.includes(role) && bill.idcard_status === "ready" && (
          <Button asChild variant="outline">
            <a href={idcardUrl} target="_blank" rel="noopener" aria-describedby={`${bill.id}-idcard-note`}>
              <IdCard aria-hidden="true" />
              {t("bill.idCard")}
              <ExternalLink aria-hidden="true" />
              <span className="sr-only">{t("bill.opensInNewTab")}</span>
            </a>
          </Button>
        )}
        {RETRY_ROLES.includes(role) && bill.status === "active" && <VoidDialog bill={bill} />}
      </div>

      <PdfStatus bill={bill} />
      {IDCARD_ROLES.includes(role) && (
        <p id={`${bill.id}-idcard-note`} className="text-sm text-muted-foreground">
          {bill.idcard_status === "none" ? t("bill.idCardNone") : t("bill.idCardNote")}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Switch
          id={`${bill.id}-autoprint`}
          checked={autoPrint}
          onCheckedChange={(on) => {
            setAutoPrint(on);
            setAutoPrintState(on);
          }}
        />
        <Label htmlFor={`${bill.id}-autoprint`} className="cursor-pointer py-1">
          {t("bill.autoPrint")}
        </Label>
      </div>
    </div>
  );
}

/** สถานะ PDF เก็บถาวร — pending ถามซ้ำเอง 2 นาที (billQuery) · เกินแล้วให้กดตรวจเอง */
function PdfStatus({ bill }: { bill: Bill }) {
  const { t } = useTranslation("buy");
  const qc = useQueryClient();
  const { dataUpdatedAt, isFetching } = useSuspenseQuery(billQuery(bill.id));
  // บิลที่ยกเลิกแล้ว: ไฟล์ที่ต้องรอคือ PDF ฉบับยกเลิก นับหน้าต่าง poll จากเวลายกเลิก ไม่ใช่เวลาสร้างบิล (มักห่างกันเกิน 2 นาที)
  const status = bill.status === "void" ? bill.void_pdf_status : bill.pdf_status;
  const since = bill.status === "void" ? (bill.voided_at ?? bill.created_at) : bill.created_at;
  const stalled = isFilePending(status) && dataUpdatedAt - Date.parse(since) >= PDF_POLL_WINDOW_MS;

  const text =
    status === "ready"
      ? t("bill.pdf.ready")
      : stalled
        ? t("bill.pdf.stalled")
        : status === "pending"
          ? t("bill.pdf.pending")
          : status === "failed"
            ? t("bill.pdf.failed")
            : status === "invalid"
              ? t("bill.pdf.invalid")
              : t("bill.pdf.other", { status });
  const Icon = status === "ready" ? CircleCheck : isFilePending(status) && !stalled ? LoaderCircle : CircleAlert;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" role="status" aria-live="polite">
      <Icon className={isFilePending(status) && !stalled ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
      <span className={FAILED.has(status) ? "text-destructive" : "text-muted-foreground"}>{text}</span>
      {stalled && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0"
          disabled={isFetching}
          onClick={() => void qc.invalidateQueries({ queryKey: billKeys.detail(bill.id) })}
        >
          {t("bill.pdf.check")}
        </Button>
      )}
    </div>
  );
}

/** ยกเลิกบิล (ผู้จัดการขึ้นไป · สาขาที่ทำงาน) — เหตุผลบังคับ · บิลไม่ถูกลบ PDF เดิมคงอยู่ (R12 · R15) */
function VoidDialog({ bill }: { bill: Bill }) {
  const { t } = useTranslation("buy");
  const id = useId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const cancel = useMutation({
    mutationFn: (text: string) => voidBill(bill.id, text),
    onSuccess: (voided) => {
      qc.setQueryData(billKeys.detail(bill.id), voided);
      void qc.invalidateQueries({ queryKey: buyKeys.lists() });
      toast.success(t("bill.void.done", { docNo: bill.doc_no }));
      setOpen(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 400) {
        setError(errorMessage(e));
        return;
      }
      if (e instanceof ApiError && e.status === 409) void qc.invalidateQueries({ queryKey: billKeys.detail(bill.id) });
      setError(
        e instanceof ApiError && e.status === 404
          ? t("bill.void.unavailable")
          : t("bill.void.failed", { error: errorMessage(e) }),
      );
    },
  });

  const submit = () => {
    const text = reason.trim();
    if (!text) {
      setError(t("bill.void.reasonRequired"));
      return;
    }
    cancel.mutate(text);
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setReason("");
          setError(null);
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="text-destructive">
          {t("bill.void.button")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("bill.void.title", { docNo: bill.doc_no })}</AlertDialogTitle>
          <AlertDialogDescription>{t("bill.void.body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor={`${id}-reason`}>{t("bill.void.reason")}</FieldLabel>
          <Textarea
            id={`${id}-reason`}
            rows={3}
            maxLength={500}
            required
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-reason-error` : `${id}-reason-hint`}
          />
          <FieldDescription id={`${id}-reason-hint`}>{t("bill.void.reasonHint")}</FieldDescription>
          <FieldError id={`${id}-reason-error`}>{error}</FieldError>
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("bill.void.cancel")}</AlertDialogCancel>
          {/* ปุ่มธรรมดา (ไม่ใช่ AlertDialogAction) — dialog ปิดเมื่อยกเลิกสำเร็จเท่านั้น */}
          <Button type="button" variant="destructive" disabled={cancel.isPending} onClick={submit}>
            {cancel.isPending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {t("bill.void.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

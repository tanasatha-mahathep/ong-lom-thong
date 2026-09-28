import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBusinessDate } from "@/hooks/use-business-date";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ApiError } from "@/lib/api";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import { formatBoardPrice, formatInteger, formatThaiDate } from "@/lib/format";
import { canSetGoldPrice } from "@/lib/nav";
import { GOLD_PRICE_SOURCE_LABEL, goldPriceTodayQueryOptions, useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { barSellErrorOf, goldPriceQuoteQueryOptions, saveGoldPrice, typoWarningOf } from "./queries";

/** หน่วง live preview ระหว่างพิมพ์ (spec §14.3) */
const QUOTE_DEBOUNCE_MS = 300;

interface Prices {
  bar_sell: string;
  bar_buy: string;
  jewelry_buy: string;
}

/** /settings/gold-price — ตั้งราคากลางของวัน (manager · admin) และราคาที่สาขาปัจจุบันใช้อยู่ */
export function GoldPricePage() {
  const { role } = useMe();
  return (
    <>
      <PageHeader description="กรอกราคาทองแท่งขายออกค่าเดียวทุกเช้า ระบบคำนวณราคารับซื้อให้" />
      <div className="grid items-start gap-4 md:gap-6 lg:grid-cols-2">
        {canSetGoldPrice(role) ? <SetPriceCard /> : <ManagersOnlyNotice />}
        <TodayPriceCard />
      </div>
    </>
  );
}

/** role อื่นเปิด URL นี้ตรง ๆ — เมนูซ่อนไว้แล้ว และ API ตอบ 403 อยู่ดี */
function ManagersOnlyNotice() {
  return (
    <Alert role="note">
      <Info aria-hidden="true" />
      <AlertTitle>ตั้งราคาทองได้เฉพาะผู้จัดการและผู้ดูแลระบบ</AlertTitle>
      <AlertDescription>ราคาผิดหรือยังไม่ได้ตั้ง แจ้งผู้จัดการของสาขา</AlertDescription>
    </Alert>
  );
}

/** error ที่ไม่ได้ชี้ช่อง — ข้อความไทยของเราเอง ไม่แสดงข้อความดิบของเซิร์ฟเวอร์ (อาจเป็นภาษาอังกฤษ) */
function requestErrorMessage(error: unknown, action: "บันทึกราคา" | "คำนวณราคา"): string {
  if (error instanceof ApiError && error.status === 0) return "ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจการเชื่อมต่อแล้วลองใหม่";
  if (error instanceof ApiError && error.status === 403)
    return "บัญชีนี้ตั้งราคาทองไม่ได้ — เฉพาะผู้จัดการและผู้ดูแลระบบ";
  return `${action}ไม่สำเร็จ ลองใหม่อีกครั้ง`;
}

/**
 * ฟอร์มค่าเดียว: พิมพ์ → quote สดจากเซิร์ฟเวอร์ → Enter บันทึก
 * ด่านกันพิมพ์ผิด (409) → AlertDialog โฟกัสที่ "กลับไปแก้ไข" ก่อน — Enter ซ้ำโดยไม่ได้อ่านจึงไม่ผ่านด่าน
 */
function SetPriceCard() {
  const ids = useId();
  const queryClient = useQueryClient();
  const today = useBusinessDate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [missing, setMissing] = useState(false);
  const [typo, setTypo] = useState<{ barSell: string; warning: string } | null>(null);

  const barSell = normalizeDecimalInput(text);
  const debounced = useDebouncedValue(barSell, QUOTE_DEBOUNCE_MS);
  const quote = useQuery({ ...goldPriceQuoteQueryOptions(debounced), placeholderData: keepPreviousData });

  const save = useMutation({
    mutationFn: saveGoldPrice,
    onSuccess: async (saved) => {
      setText("");
      toast.success("บันทึกราคาทองวันนี้แล้ว", {
        description: `ทองแท่งขายออก ${formatBoardPrice(saved.bar_sell)} บาท`,
      });
      // หัวหน้า · หน้าแรก · การ์ดราคาวันนี้ อ่านราคาของสาขาปัจจุบันใหม่ (สาขาที่มีราคาเฉพาะสาขาไม่เปลี่ยนตามราคากลาง)
      await queryClient.invalidateQueries({ queryKey: goldPriceTodayQueryOptions.queryKey });
    },
    onError: (error, body) => {
      const warning = typoWarningOf(error);
      if (warning && !body.confirm_typo) {
        setTypo({ barSell: body.bar_sell, warning });
        return;
      }
      // error อื่น: กลับไปที่ช่องราคาพร้อมเลือกข้อความ พิมพ์ทับได้ทันที
      inputRef.current?.focus();
      inputRef.current?.select();
    },
  });

  // ระหว่างพิมพ์/รอคำตอบ ผล quote ที่เห็นยังเป็นของข้อความก่อนหน้า
  const idle = barSell === "";
  const busy = !idle && (barSell !== debounced || quote.isFetching);
  const preview = idle ? undefined : quote.data;
  const quoteError = idle || busy ? null : quote.error;

  const fieldError = missing ? "กรอกราคาทองแท่งขายออก" : (barSellErrorOf(save.error) ?? barSellErrorOf(quoteError));
  const formError =
    save.error && !barSellErrorOf(save.error) && !typoWarningOf(save.error)
      ? requestErrorMessage(save.error, "บันทึกราคา")
      : null;

  const inputId = `${ids}-bar-sell`;
  const hintId = `${ids}-hint`;
  const errorId = `${ids}-error`;
  const formErrorId = `${ids}-form-error`;
  const describedBy = [fieldError && errorId, formError && formErrorId, hintId].filter(Boolean).join(" ");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (save.isPending) return;
    if (idle) {
      setMissing(true);
      inputRef.current?.focus();
      return;
    }
    save.mutate({ bar_sell: barSell });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id={`${ids}-title`}>ราคากลางวันนี้</h2>
        </CardTitle>
        <CardDescription>
          {formatThaiDate(today, "long")} · ทุกสาขาใช้ราคานี้ ยกเว้นสาขาที่ตั้งราคาเฉพาะสาขาไว้
        </CardDescription>
      </CardHeader>
      <form noValidate onSubmit={submit} aria-labelledby={`${ids}-title`} className="grid gap-6">
        <CardContent className="grid gap-6">
          {formError && (
            <Alert id={formErrorId} variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription className="text-destructive">{formError}</AlertDescription>
            </Alert>
          )}
          <Field data-invalid={!!fieldError}>
            <FieldLabel htmlFor={inputId}>ราคาทองแท่งขายออก (บาท)</FieldLabel>
            <Input
              ref={inputRef}
              id={inputId}
              name="bar_sell"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              required
              readOnly={save.isPending}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setMissing(false);
                save.reset();
              }}
              aria-invalid={!!fieldError}
              aria-describedby={describedBy}
              className="h-12 text-2xl font-semibold tabular-nums md:text-2xl"
            />
            <FieldDescription id={hintId}>พิมพ์ตัวเลข เช่น 67850 แล้วกด Enter เพื่อบันทึก</FieldDescription>
            <FieldError id={errorId}>{fieldError}</FieldError>
          </Field>
          <QuotePreview
            titleId={`${ids}-preview-title`}
            idle={idle}
            busy={busy}
            prices={preview}
            warning={preview?.warning}
            error={quoteError && !barSellErrorOf(quoteError) ? quoteError : null}
          />
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {save.isPending ? "กำลังบันทึก…" : "บันทึกราคา"}
          </Button>
        </CardFooter>
      </form>

      <AlertDialog
        open={typo !== null}
        onOpenChange={(open) => {
          if (!open) setTypo(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            // กลับไปที่ช่องราคา แก้ตัวเลขต่อได้ทันที (ไม่มีปุ่ม trigger ให้คืนโฟกัส)
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันราคาทองวันนี้</AlertDialogTitle>
            <AlertDialogDescription>{typo?.warning}</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm">ถ้าราคาถูกต้องให้กดยืนยัน ถ้าพิมพ์ผิดให้กลับไปแก้ไข</p>
          <AlertDialogFooter>
            <AlertDialogCancel>กลับไปแก้ไข</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (typo) save.mutate({ bar_sell: typo.barSell, confirm_typo: true });
              }}
            >
              ยืนยันบันทึกราคานี้
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** ผลจาก POST /gold-price/quote — live region: โปรแกรมอ่านจอประกาศเมื่อคำนวณเสร็จ (aria-busy กันประกาศระหว่างพิมพ์) */
function QuotePreview({
  titleId,
  idle,
  busy,
  prices,
  warning,
  error,
}: {
  titleId: string;
  idle: boolean;
  busy: boolean;
  prices: Prices | undefined;
  warning: string | undefined;
  error: Error | null;
}) {
  return (
    <section aria-labelledby={titleId} className="grid gap-3 rounded-lg border p-4">
      <h3 id={titleId} className="text-sm font-medium">
        ราคาที่จะบันทึก
      </h3>
      <div role="status" aria-busy={busy} className="grid gap-3">
        {idle ? (
          <p className="text-sm text-muted-foreground">กรอกราคาทองแท่งขายออก แล้วระบบจะคำนวณราคารับซื้อให้</p>
        ) : (
          <>
            <PriceList prices={prices} muted={busy} />
            {busy ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                กำลังคำนวณ…
              </p>
            ) : error ? (
              <p className="text-sm text-destructive">{requestErrorMessage(error, "คำนวณราคา")}</p>
            ) : (
              warning && (
                <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
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

/** ราคาของสาขาปัจจุบันจาก GET /gold-price/today — ราคาเฉพาะสาขามาก่อนราคากลาง (null = ยังไม่ได้ตั้ง) */
function TodayPriceCard() {
  const titleId = useId();
  const me = useMe();
  const today = useBusinessDate();
  const { data: price, isPending, refetch } = useQuery(goldPriceTodayQueryOptions);

  return (
    <section aria-labelledby={titleId} aria-busy={isPending}>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={titleId}>ราคาที่สาขานี้ใช้เปิดบิลวันนี้</h2>
          </CardTitle>
          <CardDescription>
            {me.branch?.name ?? "ยังไม่ได้เลือกสาขา"} · {formatThaiDate(price?.date ?? today, "long")}
          </CardDescription>
          {price && (
            <CardAction>
              <Badge variant="outline">{GOLD_PRICE_SOURCE_LABEL[price.source]}</Badge>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="grid gap-3">
          {price === undefined ? (
            isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <div className="grid justify-items-start gap-2">
                <p className="text-destructive">โหลดราคาทองวันนี้ไม่ได้</p>
                <Button variant="outline" size="sm" onClick={() => void refetch()}>
                  ลองใหม่
                </Button>
              </div>
            )
          ) : price ? (
            <>
              <PriceList prices={price} />
              {price.source === "branch" && (
                <p className="text-sm text-muted-foreground">
                  สาขานี้ตั้งราคาเฉพาะสาขาไว้ — ราคากลางที่บันทึกจากหน้านี้ไม่เปลี่ยนราคาของสาขานี้
                </p>
              )}
            </>
          ) : (
            <p>ยังไม่ได้ตั้งราคาทองวันนี้ — เปิดบิลซื้อเข้าไม่ได้จนกว่าจะตั้งราคา</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function PriceList({ prices, muted = false }: { prices: Prices | undefined; muted?: boolean }) {
  return (
    <dl className="grid gap-2">
      <PriceRow label="ทองแท่งขายออก" value={formatBoardPrice(prices?.bar_sell)} muted={muted} />
      <PriceRow label="ทองแท่งรับซื้อ" value={formatBoardPrice(prices?.bar_buy)} muted={muted} />
      <PriceRow label="ทองรูปพรรณรับซื้อ" value={formatInteger(prices?.jewelry_buy)} muted={muted} />
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

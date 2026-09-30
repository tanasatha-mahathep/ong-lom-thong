import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, Info, LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useBusinessDate } from "@/hooks/use-business-date";
import { formatBoardPrice, formatThaiDate } from "@/lib/format";
import { canSetGoldPrice } from "@/lib/nav";
import { goldPriceTodayQueryOptions, goldReferenceQueryOptions, useMe } from "@/lib/queries";
import { BranchPricesCard } from "./branch-prices";
import { useTranslation } from "./i18n";
import { PriceFormError, PriceInputField, PriceList, QuotePreview, TypoConfirmDialog } from "./price-form";
import { saveGoldPrice } from "./queries";
import { ReferencePricePanel } from "./reference-price";
import { usePriceForm } from "./use-price-form";

/**
 * /settings/gold-price — ตั้งราคากลางของวัน (manager · admin) · ราคาที่สาขาปัจจุบันใช้อยู่
 * · ราคาเฉพาะสาขา (manager · admin — สาขาที่บัญชีนี้จัดการได้)
 */
export function GoldPricePage() {
  const { t } = useTranslation("goldPrice");
  const { role } = useMe();
  const manager = canSetGoldPrice(role);
  return (
    <>
      <PageHeader description={t("description")} />
      <div className="grid grid-cols-1 items-start gap-4 md:gap-6 lg:grid-cols-2">
        {manager ? <SetPriceCard /> : <ManagersOnlyNotice />}
        <TodayPriceCard />
        {manager && <BranchPricesCard className="lg:col-span-2" />}
      </div>
    </>
  );
}

/** role อื่นเปิด URL นี้ตรง ๆ — เมนูซ่อนไว้แล้ว และ API ตอบ 403 อยู่ดี */
function ManagersOnlyNotice() {
  const { t } = useTranslation("goldPrice");
  return (
    <Alert role="note">
      <Info aria-hidden="true" />
      <AlertTitle>{t("managersOnly.title")}</AlertTitle>
      <AlertDescription>{t("managersOnly.body")}</AlertDescription>
    </Alert>
  );
}

/**
 * ราคากลางของวัน: พิมพ์ → quote สดจากเซิร์ฟเวอร์ → Enter บันทึก
 * ด่านกันพิมพ์ผิด (409) → AlertDialog โฟกัสที่ "กลับไปแก้ไข" ก่อน — Enter ซ้ำโดยไม่ได้อ่านจึงไม่ผ่านด่าน
 * ราคาสมาคม (อ้างอิง): ปุ่มเติมค่าเริ่มต้น (ไม่บันทึก) · วันนี้ยังไม่มีราคา → เติมให้เองครั้งเดียว (ยกเว้นประกาศเก่า)
 * — ระบบไม่ตั้งราคาร้านเอง ผู้จัดการต้องกดบันทึก
 */
function SetPriceCard() {
  const { t } = useTranslation("goldPrice");
  const titleId = useId();
  const queryClient = useQueryClient();
  const today = useBusinessDate();
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: todayPrice } = useQuery(goldPriceTodayQueryOptions);
  const { data: reference } = useQuery(goldReferenceQueryOptions);
  const form = usePriceForm({
    inputRef,
    currentReference: reference ?? null,
    save: saveGoldPrice,
    onSaved: async (saved) => {
      toast.success(t("saved"), {
        description: t("savedDescription", { price: formatBoardPrice(saved.bar_sell) }),
      });
      // หัวหน้า · หน้าหลัก · การ์ดราคาวันนี้ · ตารางราคาเฉพาะสาขา อ่านใหม่ (key ร่วม ["gold-price","today"])
      // สาขาที่มีราคาเฉพาะสาขาไม่เปลี่ยนตามราคากลาง — ตารางแสดงที่มาของแต่ละสาขาหลังอ่านใหม่
      await queryClient.invalidateQueries({ queryKey: goldPriceTodayQueryOptions.queryKey });
    },
  });

  // วันนี้ยังไม่ได้ตั้งราคา (null — ไม่ใช่ยังโหลด/โหลดล้ม) + มีราคาสมาคมของวันนี้ + ช่องยังว่าง → เติมให้ครั้งเดียว
  const autoFilled = useRef(false);
  const { prefill, text } = form;
  useEffect(() => {
    if (autoFilled.current || todayPrice !== null || !reference || reference.stale || text !== "") return;
    autoFilled.current = true;
    prefill(reference, { focus: false });
  }, [todayPrice, reference, text, prefill]);

  return (
    <>
      {/* เต็มความกว้าง (lg:col-span-2) แทนที่จะอยู่ในการ์ดครึ่งจอ — การ์ด 4 ใบก่อนหน้านี้ดันช่องกรอกราคาลงไปไกล
          (~1000px จนต้องเลื่อนจอ) ขณะที่การ์ด "ราคาที่สาขานี้ใช้เปิดบิลวันนี้" ข้าง ๆ สูงแค่ ~140px ย้ายออกมา
          ให้แถวถัดไปเป็นฟอร์ม (สั้นลงมาก) คู่กับการ์ดนั้นแทน ส่วนกรอบเองก็ได้ขึ้น 4 คอลัมน์เหมือนหน้าหลักด้วย */}
      <ReferencePricePanel
        className="lg:col-span-2"
        headingLevel={2}
        action={(ref) =>
          // ประกาศเก่า (ไม่ใช่ของวันนี้ / ดึงรอบล่าสุดไม่สำเร็จ) — ไม่ให้เติม ต้องกรอกเองจากประกาศล่าสุด
          ref.stale ? (
            <p className="text-sm text-muted-foreground">{t("reference.staleNoPrefill")}</p>
          ) : (
            <Button type="button" variant="outline" className="justify-self-start" onClick={() => prefill(ref)}>
              <ClipboardPaste aria-hidden="true" />
              {t("reference.use")}
            </Button>
          )
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={titleId}>{t("central.title")}</h2>
          </CardTitle>
          <CardDescription>{t("central.description", { date: formatThaiDate(today, "long") })}</CardDescription>
        </CardHeader>
        <form noValidate onSubmit={form.submit} aria-labelledby={titleId} className="grid gap-6">
          <CardContent className="grid gap-6">
            <PriceFormError form={form} />
            <PriceInputField form={form} inputRef={inputRef} label={t("barSellLabel")} autoFocus />
            {/* live region อยู่ก่อนเสมอ — ข้อความที่เพิ่มเข้ามาภายหลังจึงถูกประกาศ */}
            <div role="status">
              {form.referenceChanged && !form.fromReference ? (
                <p className="rounded-md border border-warning-border bg-warning px-3 py-2 text-sm text-warning-foreground">
                  {t("reference.changed")}
                </p>
              ) : (
                form.fromReference && (
                  <p className="rounded-md border border-warning-border bg-warning px-3 py-2 text-sm text-warning-foreground">
                    {t("reference.prefilled")}
                  </p>
                )
              )}
            </div>
            <QuotePreview form={form} />
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={form.saving}>
              {form.saving && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              {form.saving ? t("saving", { ns: "common" }) : t("save")}
            </Button>
          </CardFooter>
        </form>
        <TypoConfirmDialog form={form} title={t("typo.title")} />
      </Card>
    </>
  );
}

/** ราคาของสาขาปัจจุบันจาก GET /gold-price/today — ราคาเฉพาะสาขามาก่อนราคากลาง (null = ยังไม่ได้ตั้ง) */
function TodayPriceCard() {
  const { t } = useTranslation("goldPrice");
  const titleId = useId();
  const me = useMe();
  const today = useBusinessDate();
  const { data: price, isPending, refetch } = useQuery(goldPriceTodayQueryOptions);

  return (
    <section aria-labelledby={titleId} aria-busy={isPending}>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={titleId}>{t("todayCard.title")}</h2>
          </CardTitle>
          <CardDescription>
            {t("todayCard.description", {
              branch: me.branch?.name ?? t("noBranch", { ns: "common" }),
              date: formatThaiDate(price?.date ?? today, "long"),
            })}
          </CardDescription>
          {price && (
            <CardAction>
              <Badge variant="outline">{t(`goldPrice.source.${price.source}`, { ns: "common" })}</Badge>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="grid gap-3">
          {price === undefined ? (
            isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <div className="grid justify-items-start gap-2">
                <p className="text-destructive">
                  {t("loadFailed", { ns: "common", what: t("goldPrice.today", { ns: "common" }) })}
                </p>
                <Button variant="outline" size="sm" onClick={() => void refetch()}>
                  {t("retry", { ns: "common" })}
                </Button>
              </div>
            )
          ) : price ? (
            <>
              <PriceList prices={price} />
              {price.source === "branch" && (
                <p className="text-sm text-muted-foreground">{t("todayCard.branchOverride")}</p>
              )}
            </>
          ) : (
            <p>{t("todayCard.notSet")}</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

import { LoaderCircle, Save } from "lucide-react";
import { useId, useRef } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useTranslation } from "../i18n";
import type { BuyController } from "../use-buy-controller";

/** แถบล่างติดจอ: ยอดรวม · ชำระแล้ว · คงเหลือ (จาก quote) · เหตุที่ยังบันทึกไม่ได้ · บันทึก · ล้างบิล */
export function SaveBar({ c }: { c: BuyController }) {
  const { t } = useTranslation("buy");
  const id = useId();
  const { quote, fresh, saveBlock, saving, register, actions } = c;
  const cleared = useRef(false);
  const ready = saveBlock === null;

  return (
    // เต็มความกว้างของพื้นที่เนื้อหา (ชิดขอบ sidebar ถึงขอบขวา) แม้หน้าจะอยู่ในกล่อง max-w-5xl: 100cqw = ความกว้าง
    // เนื้อหาของ <main> (@container/main ใน _app.tsx) + padding ของ main (--main-px) · เนื้อในยังตรงแนวกับหน้า
    <div
      data-slot="save-bar"
      className="sticky bottom-0 z-20 mx-[calc((100%_-_100cqw)/2_-_var(--main-px,1rem))] w-[calc(100cqw_+_2*var(--main-px,1rem))] border-t-2 bg-background px-(--main-px,1rem) pt-3 pb-[calc(0.75rem_+_env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2">
        <dl className={cn("flex flex-wrap gap-x-6 gap-y-1", !fresh && "text-muted-foreground")} aria-busy={!fresh}>
          <Total label={t("save.total")} value={quote?.total_amount} strong />
          <Total label={t("save.paid")} value={quote?.paid} />
          <Total label={t("save.balance")} value={quote?.balance} />
        </dl>
        <p id={`${id}-reason`} className="min-w-0 flex-1 text-sm text-muted-foreground">
          {saveBlock?.message}
        </p>
        <div className="flex items-center gap-2">
          {/* aria-disabled (ไม่ใช่ disabled) — ยังโฟกัสได้ กดแล้วพาไปช่องที่ต้องแก้ */}
          <Button
            ref={(el) => register("save", el)}
            type="button"
            size="lg"
            aria-disabled={!ready}
            aria-describedby={`${id}-reason`}
            className="aria-disabled:cursor-not-allowed aria-disabled:bg-muted aria-disabled:text-muted-foreground aria-disabled:shadow-none"
            onClick={() => void actions.submit()}
          >
            {saving ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
            {saving ? t("saving", { ns: "common" }) : t("save.button")}
            <KbdGroup className="max-sm:hidden">
              <Kbd>{t("keys.ctrl")}</Kbd>
              <Kbd>{t("keys.enter")}</Kbd>
            </KbdGroup>
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost">
                {t("save.clear")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent
              onCloseAutoFocus={(e) => {
                // ล้างแล้วเริ่มบิลใหม่ที่ช่องเลขบัตร (ไม่กลับไปปุ่มล้างบิล)
                if (!cleared.current) return;
                cleared.current = false;
                e.preventDefault();
                actions.focusOn("idBox");
              }}
            >
              <AlertDialogHeader>
                <AlertDialogTitle>{t("save.clearTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("save.clearBody")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("save.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    cleared.current = true;
                    actions.clearBill();
                  }}
                >
                  {t("save.clear")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}

function Total({ label, value, strong }: { label: string; value: string | undefined; strong?: boolean }) {
  const { t } = useTranslation("buy");
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn("tabular-nums", strong ? "text-lg font-bold" : "font-semibold")}>
        {formatMoney(value)}
        <span className="ml-1 text-sm font-normal text-muted-foreground">{t("baht", { ns: "common" })}</span>
      </dd>
    </div>
  );
}

/**
 * 409 idempotency_key + existing: key นี้บันทึกบิลอื่นไปแล้ว (ครั้งก่อนสำเร็จแต่ไม่ได้รับคำตอบ แล้วบิลถูกแก้)
 * ให้เลือกเอง: เปิดบิลที่บันทึกแล้ว หรือบันทึกบิลที่กรอกอยู่เป็นใบใหม่ (key ใหม่)
 */
export function ConflictDialog({ c }: { c: BuyController }) {
  const { t } = useTranslation("buy");
  const { conflict, actions } = c;
  return (
    <AlertDialog open={conflict !== null} onOpenChange={(open) => !open && actions.closeConflict()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{conflict ? t("save.conflictTitle", { docNo: conflict.doc_no }) : ""}</AlertDialogTitle>
          <AlertDialogDescription>{t("save.conflictBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("save.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="outline" onClick={actions.saveAsNew}>
            {t("save.conflictSaveNew")}
          </AlertDialogAction>
          <AlertDialogAction onClick={actions.openExisting}>{t("save.conflictOpen")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

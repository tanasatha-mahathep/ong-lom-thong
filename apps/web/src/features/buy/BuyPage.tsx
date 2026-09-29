import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Info, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { type Branch, type Me, useMe } from "@/lib/queries";
import { useUnsavedChanges } from "@/lib/unsaved-changes";
import { BillHeaderCard } from "./components/BillHeaderCard";
import { CustomerCard } from "./components/CustomerCard";
import { LinesCard } from "./components/LinesCard";
import { PaymentsCard } from "./components/PaymentsCard";
import { ConflictDialog, SaveBar } from "./components/SaveBar";
import { useTranslation } from "./i18n";
import type { BuyState } from "./model";
import { metalsQuery } from "./queries";
import { useBuyController } from "./use-buy-controller";

/**
 * ซื้อเข้าหน้าร้าน (spec §3.1) — คีย์บอร์ดล้วน · ยอดทุกตัวมาจาก POST /api/buy/quote
 * ไม่มี <form>: Enter ท้ายการเสียบบัตรของ Siam ID จึงไม่มีทางกดบันทึก · บันทึก = ปุ่มหรือ Ctrl+Enter
 */
export function BuyPage() {
  const { t } = useTranslation("buy");
  const me = useMe();

  if (me.role === "accounting") {
    return (
      <>
        <PageHeader />
        <Alert>
          <Info aria-hidden="true" />
          <AlertTitle>{t("access.accountingTitle")}</AlertTitle>
          <AlertDescription className="text-foreground">
            <p>
              {t("access.accountingBody")} ·{" "}
              <Link to="/bills" className="font-medium underline underline-offset-4">
                {t("access.toBills")}
              </Link>
            </p>
          </AlertDescription>
        </Alert>
      </>
    );
  }
  if (me.branch === null) {
    return (
      <>
        <PageHeader />
        <NoBranchAlert branchClosed={me.branch_closed ?? null} />
      </>
    );
  }
  // สลับสาขากลางบิล: ถามยืนยันก่อน แล้วหน้าเริ่มใหม่ทั้งหน้า (Outlet ใน _app.tsx mount ใหม่ตามสาขา)
  return <BuyForm me={me} />;
}

/** มีอะไรกรอกไว้ที่หายได้ถ้าหน้าเริ่มใหม่ — ลูกค้า · แถว · การชำระ · ช่องที่พิมพ์ค้าง · ย้อนหลัง */
function isBillDirty(state: BuyState): boolean {
  return (
    state.customer !== null ||
    state.lines.length > 0 ||
    state.payments.length > 0 ||
    state.backdate.enabled ||
    [
      state.idText,
      state.searchText,
      state.detail,
      state.lineEntry.weight_g,
      state.lineEntry.amount,
      state.paymentEntry.amount,
      state.paymentEntry.bank,
    ].some((text) => text.trim() !== "")
  );
}

/**
 * branchClosed ไม่ null เฉพาะตอน session ชี้สาขาที่เพิ่งถูกปิด (ต่างจาก "ยังไม่ได้เลือกสาขา" ที่ยังไม่เคยเลือกเลย)
 * ข้อความตรงกับที่ quote/save ตอบกลับตอน 403 field:"branch" (services/buy.ts) ให้ตรงกันทั้งหน้า
 */
function NoBranchAlert({ branchClosed }: { branchClosed: Branch | null }) {
  const { t } = useTranslation("buy");
  return (
    <Alert variant="destructive">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>{branchClosed ? t("access.branchClosedTitle") : t("access.noBranchTitle")}</AlertTitle>
      <AlertDescription>
        {branchClosed ? t("access.branchClosedBody", { name: branchClosed.name }) : t("access.noBranchBody")}
      </AlertDescription>
    </Alert>
  );
}

function BuyForm({ me }: { me: Me }) {
  const { t } = useTranslation("buy");
  const { data: metals } = useSuspenseQuery(metalsQuery);
  const c = useBuyController(me, metals);
  // สลับสาขาล้างบิลที่กรอกค้าง — ถามยืนยันก่อน (components/branch-switcher.tsx)
  useUnsavedChanges(isBillDirty(c.state));

  return (
    // scroll-mb: ช่องที่โฟกัสต้องไม่ถูกแถบบันทึกด้านล่างบัง (WCAG 2.4.11)
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 [&_:is(input,textarea,button,a,[role=radio],[role=switch])]:scroll-mb-40">
      <PageHeader />
      {c.noBranch && <NoBranchAlert branchClosed={c.me.branch_closed ?? null} />}
      <fieldset disabled={c.saving} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <legend className="sr-only">{t("page.form")}</legend>
        <BillHeaderCard c={c} />
        <CustomerCard c={c} />
        <LinesCard c={c} />
        <PaymentsCard c={c} />
        <SaveBar c={c} />
      </fieldset>
      <KeyHints />
      <ConflictDialog c={c} />
    </div>
  );
}

function KeyHints() {
  const { t } = useTranslation("buy");
  return (
    <section aria-label={t("hints.title")} className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Kbd>{t("keys.enter")}</Kbd>
        {t("hints.next")}
      </span>
      <span className="flex items-center gap-1.5">
        <Kbd>{t("keys.esc")}</Kbd>
        {t("hints.clearRow")}
      </span>
      <span className="flex items-center gap-1.5">
        <KbdGroup>
          <Kbd>{t("keys.ctrl")}</Kbd>
          <Kbd>{t("keys.enter")}</Kbd>
        </KbdGroup>
        {t("hints.save")}
      </span>
    </section>
  );
}

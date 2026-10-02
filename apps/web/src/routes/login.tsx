import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Trans, useTranslation } from "react-i18next";
import { AppVersion } from "@/components/app-version";
import { LoginForm } from "@/components/login-form";
import { LanguageMenu, ThemeMenu } from "@/components/preference-menus";
import { LegalDialog } from "@/features/legal/legal-dialog";
import { meQueryOptions } from "@/lib/queries";
import { useBlockingNavigate } from "@/lib/blocking";
import { safeRedirect } from "@/lib/session";

export const Route = createFileRoute("/login")({
  // ต้องคืน key redirect เสมอ — TanStack รวม search ดิบของ root เข้ามา ถ้าไม่ทับ ค่าที่ไม่ผ่านจะหลุดรอด
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: safeRedirect(search.redirect),
  }),
  beforeLoad: async ({ context: { queryClient }, search }) => {
    // login อยู่แล้ว → เข้าแอปเลย · 401 (หรือเซิร์ฟเวอร์ไม่ตอบ) → แสดงฟอร์ม
    const signedIn = await queryClient.fetchQuery({ ...meQueryOptions, staleTime: 0 }).then(
      () => true,
      () => false,
    );
    if (signedIn) throw redirect({ href: safeRedirect(search.redirect) ?? "/", replace: true });
  },
  staticData: { title: "login" },
  component: LoginPage,
});

/**
 * หน้า login-04 — การ์ดสองฝั่ง (ฟอร์ม · แผงชื่อร้าน) บนพื้น muted · มุมขวาบน: ภาษา + ธีม
 * ใต้การ์ด: ประโยคยอมรับข้อกำหนด/นโยบาย (เดิมอยู่ในการ์ด ย้ายมาไว้นอกการ์ดตามที่เจ้าของขอ 30 ก.ย.)
 * เห็นเฉพาะขั้นกรอกอีเมล/รหัสผ่าน — ขั้นเลือกสาขา (บัญชีหลายสาขา) ไม่แสดงซ้ำ เหมือนพฤติกรรมเดิมก่อนย้าย
 * มุมซ้ายล่างของจอ: เวอร์ชัน (เดิมอยู่กึ่งกลางใต้ประโยคยอมรับ) เห็นทั้งสองขั้นเหมือนเดิม ไม่เปลี่ยน
 */
function LoginPage() {
  const { t } = useTranslation("auth");
  const search = Route.useSearch();
  // login สำเร็จ → บังหน้าจอ "กำลังทำงาน…" จนหน้าปลายทางโหลดเสร็จ (U6)
  const navigate = useBlockingNavigate();
  const [step, setStep] = useState<"signIn" | "branch">("signIn");

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-4 pt-16 sm:p-6 sm:pt-16 md:p-10">
      {/* ภาษา · ธีม มุมขวาบน — ยังไม่ login ก็เลือกได้ (ตัวเดียวกับเมนูผู้ใช้ใน sidebar) */}
      <div className="absolute top-3 right-3 flex items-center gap-1">
        <LanguageMenu />
        <ThemeMenu />
      </div>
      <main className="w-full max-w-sm md:max-w-4xl">
        <LoginForm
          onStepChange={setStep}
          onDone={() => navigate({ href: safeRedirect(search.redirect) ?? "/", replace: true })}
        />
      </main>
      {step === "signIn" && (
        // <p> ธรรมดา ไม่ใช้ FieldDescription — นอกบริบท Field/FieldGroup แล้ว จะเลี่ยงกฎ margin ของมัน
        // (ตั้งใจไว้สำหรับ description เรียงกันในฟอร์ม) ที่ชนตำแหน่งพี่น้องที่นี่โดยบังเอิญ
        // ไม่ตั้ง max-w: ปล่อยให้เป็นแถวเดียวเมื่อที่พอ (shrink-to-fit ของ block ใน flex column)
        // ตัดบรรทัดเองเฉพาะจอแคบที่ไม่พอจริง ๆ (ตัวอักษรใหญ่/มือถือแคบมาก)
        <p className="max-w-full px-2 text-center text-sm leading-normal text-muted-foreground">
          <Trans
            t={t}
            i18nKey="signIn.consent"
            components={{ terms: <LegalDialog doc="terms" />, privacy: <LegalDialog doc="privacy" /> }}
          />
        </p>
      )}
      <AppVersion className="absolute bottom-3 left-3 w-auto text-left" />
    </div>
  );
}

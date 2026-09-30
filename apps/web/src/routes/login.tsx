import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppVersion } from "@/components/app-version";
import { LoginForm } from "@/components/login-form";
import { LanguageMenu, ThemeMenu } from "@/components/preference-menus";
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

/** หน้า login-04 — การ์ดสองฝั่ง (ฟอร์ม · แผงชื่อร้าน) บนพื้น muted · มุมขวาบน: ภาษา + ธีม · ท้ายหน้า: เวอร์ชัน */
function LoginPage() {
  const search = Route.useSearch();
  // login สำเร็จ → บังหน้าจอ "กำลังทำงาน…" จนหน้าปลายทางโหลดเสร็จ (U6)
  const navigate = useBlockingNavigate();

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-4 pt-16 sm:p-6 sm:pt-16 md:p-10">
      {/* ภาษา · ธีม มุมขวาบน — ยังไม่ login ก็เลือกได้ (ตัวเดียวกับเมนูผู้ใช้ใน sidebar) */}
      <div className="absolute top-3 right-3 flex items-center gap-1">
        <LanguageMenu />
        <ThemeMenu />
      </div>
      <main className="w-full max-w-sm md:max-w-4xl">
        <LoginForm onDone={() => navigate({ href: safeRedirect(search.redirect) ?? "/", replace: true })} />
      </main>
      <AppVersion className="w-full" />
    </div>
  );
}

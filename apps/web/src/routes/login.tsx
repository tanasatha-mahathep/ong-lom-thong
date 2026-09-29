import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginForm } from "@/components/login-form";
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

/** หน้า login-04 — การ์ดสองฝั่ง (ฟอร์ม · แผงชื่อร้าน) บนพื้น muted */
function LoginPage() {
  const search = Route.useSearch();
  // login สำเร็จ → บังหน้าจอ "กำลังทำงาน…" จนหน้าปลายทางโหลดเสร็จ (U6)
  const navigate = useBlockingNavigate();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-4 sm:p-6 md:p-10">
      <main className="w-full max-w-sm md:max-w-4xl">
        <LoginForm onDone={() => navigate({ href: safeRedirect(search.redirect) ?? "/", replace: true })} />
      </main>
    </div>
  );
}

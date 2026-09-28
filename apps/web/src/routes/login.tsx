import { createFileRoute, redirect } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/page-placeholder";
import { meQueryOptions } from "@/lib/queries";
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
  staticData: { title: "เข้าสู่ระบบ" },
  component: PagePlaceholder,
});

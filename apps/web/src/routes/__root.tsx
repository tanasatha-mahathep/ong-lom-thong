import type { QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { useEffect } from "react";
import { RootNotFoundPage } from "@/components/status-page";
import { Toaster } from "@/components/ui/sonner";
import { usePageMeta } from "@/hooks/use-page-meta";
import { SHOP_NAME } from "@/lib/shop";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  // deep link ที่ไม่มีหน้า (SPA fallback ของ api ส่ง index.html มา) — 404 ภาษาไทย ไม่ใช่ค่าเริ่มต้นของ TanStack
  notFoundComponent: RootNotFoundPage,
});

function RootLayout() {
  const { title } = usePageMeta();
  useEffect(() => {
    document.title = title ? `${title} · ${SHOP_NAME}` : SHOP_NAME;
  }, [title]);

  return (
    <>
      <Outlet />
      <Toaster />
    </>
  );
}

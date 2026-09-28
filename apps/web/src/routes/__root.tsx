import type { QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ThemeProvider } from "@/components/theme-provider";
import { RootNotFoundPage } from "@/components/status-page";
import { Toaster } from "@/components/ui/sonner";
import { usePageMeta } from "@/hooks/use-page-meta";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  // deep link ที่ไม่มีหน้า (SPA fallback ของ api ส่ง index.html มา) — 404 ภาษาไทย ไม่ใช่ค่าเริ่มต้นของ TanStack
  notFoundComponent: RootNotFoundPage,
});

function RootLayout() {
  const { t } = useTranslation("shell");
  const { title } = usePageMeta();
  const shopName = t("shopName", { ns: "common" });
  const pageTitle = title ? t(`routes.${title}`) : undefined;
  useEffect(() => {
    document.title = pageTitle ? `${pageTitle} · ${shopName}` : shopName;
  }, [pageTitle, shopName]);

  return (
    <ThemeProvider>
      <Outlet />
      <Toaster />
    </ThemeProvider>
  );
}

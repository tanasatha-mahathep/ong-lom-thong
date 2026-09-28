import type { QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { usePageMeta } from "@/hooks/use-page-meta";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
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

import type { QueryClient } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { usePageMeta } from "@/hooks/use-page-meta";
import { SHOP_NAME } from "@/lib/shop";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
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

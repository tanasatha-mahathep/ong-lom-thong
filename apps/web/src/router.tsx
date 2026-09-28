import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RouterHistory, createRouter } from "@tanstack/react-router";
import { ErrorPage, NotFoundPage } from "@/components/status-page";
import { ApiError } from "@/lib/api";
import type { AppPath } from "@/lib/nav";
import { routeTree } from "@/routeTree.gen";

interface RequestMeta extends Record<string, unknown> {
  /** query/mutation จัดการ 401 เอง (query `me` · ฟอร์ม login) — ตัวดักกลางไม่ต้องพาไปหน้า login */
  handlesUnauthorized?: boolean;
}

/** ขั้นก่อนหน้าใน breadcrumb — ไม่มี `to` = ชื่อกลุ่มเมนู ไม่ใช่ลิงก์ */
export interface Crumb {
  title: string;
  to?: AppPath;
}

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: RequestMeta;
    mutationMeta: RequestMeta;
  }
}

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
  interface StaticDataRouteOption {
    /** ชื่อหน้าภาษาไทย — หัวหน้า · breadcrumb · document.title */
    title?: string;
    /** ขั้นก่อนหน้าใน breadcrumb (ไม่รวมหน้านี้) */
    crumbs?: readonly Crumb[];
  }
}

/** 4xx คือคำตอบจริงของเซิร์ฟเวอร์ ลองซ้ำก็ได้ผลเดิม — ลองซ้ำเฉพาะติดต่อไม่ได้ / 5xx */
const retry = (failureCount: number, error: Error) =>
  error instanceof ApiError && (error.status === 0 || error.status >= 500) && failureCount < 2;

/** router + QueryClient ของแอป — เทสต์สร้างใหม่ทุกครั้งพร้อม memory history */
export function createAppRouter({ history }: { history?: RouterHistory } = {}) {
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (!query.meta?.handlesUnauthorized) onUnauthorized(error);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _result, mutation) => {
        if (!mutation.meta?.handlesUnauthorized) onUnauthorized(error);
      },
    }),
    defaultOptions: { queries: { retry } },
  });

  const router = createRouter({
    routeTree,
    history,
    context: { queryClient },
    defaultPreload: "intent",
    // ความสดของข้อมูลให้ TanStack Query ตัดสิน — router เรียก loader ทุกครั้ง
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    defaultNotFoundComponent: NotFoundPage,
    defaultErrorComponent: ErrorPage,
    Wrap: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });

  /** session หมดอายุระหว่างใช้งาน → ไปหน้า login แล้วล้าง cache (ข้อมูลลูกค้า/บิลไม่ค้างในเครื่อง) */
  function onUnauthorized(error: unknown) {
    if (!(error instanceof ApiError) || error.status !== 401) return;
    const { pathname, href } = router.state.location;
    if (pathname === "/login") return;
    void router.navigate({ to: "/login", search: { redirect: href }, replace: true }).then(() => queryClient.clear());
  }

  return router;
}

export type AppRouter = ReturnType<typeof createAppRouter>;

import { useMatches } from "@tanstack/react-router";
import type { Crumb, RouteTitle } from "@/router";

const NO_CRUMBS: readonly Crumb[] = [];

/** key ชื่อหน้า + breadcrumb ของหน้าปัจจุบัน จาก `staticData` ของ route ลึกสุดที่มี title (แปลด้วย t ตอนแสดง) */
export function usePageMeta(): { title: RouteTitle | undefined; crumbs: readonly Crumb[] } {
  const title = useMatches({ select: (matches) => matches.findLast((m) => m.staticData.title)?.staticData.title });
  const crumbs = useMatches({
    select: (matches) => matches.findLast((m) => m.staticData.title)?.staticData.crumbs ?? NO_CRUMBS,
  });
  return { title, crumbs };
}

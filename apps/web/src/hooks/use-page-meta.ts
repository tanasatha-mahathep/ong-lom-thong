import { useMatches } from "@tanstack/react-router";
import type { Crumb } from "@/router";

const NO_CRUMBS: readonly Crumb[] = [];

/** ชื่อหน้า + breadcrumb ของหน้าปัจจุบัน จาก `staticData` ของ route ลึกสุดที่มี title */
export function usePageMeta(): { title: string | undefined; crumbs: readonly Crumb[] } {
  const title = useMatches({ select: (matches) => matches.findLast((m) => m.staticData.title)?.staticData.title });
  const crumbs = useMatches({
    select: (matches) => matches.findLast((m) => m.staticData.title)?.staticData.crumbs ?? NO_CRUMBS,
  });
  return { title, crumbs };
}

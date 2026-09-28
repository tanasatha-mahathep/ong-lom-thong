import type { ReactNode } from "react";
import { usePageMeta } from "@/hooks/use-page-meta";

/** หัวเรื่องของหน้า (h1 เดียวของหน้า) — ชื่อมาจาก `staticData.title` ของ route */
export function PageHeader({ description, actions }: { description?: ReactNode; actions?: ReactNode }) {
  const { title } = usePageMeta();
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{title}</h1>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

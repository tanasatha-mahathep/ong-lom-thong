import type { ReactNode } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * tooltip ของปุ่มที่เปิดเมนู (ตัวเลือกสาขา · เมนูผู้ใช้) ตอน sidebar ย่อเป็นแถบไอคอน — แบบเดียวกับ
 * `SidebarMenuButton tooltip` แต่ครอบ DropdownMenuTrigger ได้ (tooltip ของ SidebarMenuButton ใต้ Trigger asChild
 * ทำให้ props ของ Trigger ไม่ถึงปุ่ม) · ขยายอยู่/มือถือ = ซ่อน (ชื่อเห็นอยู่แล้ว)
 */
export function RailTooltip({ label, children }: { label: string; children: ReactNode }) {
  const { isMobile, state } = useSidebar();
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" align="center" hidden={state !== "collapsed" || isMobile}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

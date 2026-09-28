import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * โลโก้ร้าน (SVG ล้วน ไม่มีไฟล์รูป) — หยดทองหลอมเหนือทองแท่ง 3 ก้อน บนพื้นเข้ม
 * ใช้ที่หัว sidebar และหน้า login · ประดับเท่านั้น (aria-hidden) ชื่อร้านอยู่ในข้อความข้าง ๆ เสมอ
 */
export function BrandMark({ className }: { className?: string }) {
  // id ไม่ซ้ำต่อ instance — หน้าเดียวมีโลโก้ได้หลายที่
  const gold = `${useId()}-gold`;
  const fill = `url(#${gold})`;
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0 rounded-[22%] bg-neutral-900", className)}
    >
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbe7a6" />
          <stop offset="0.55" stopColor="#dcae48" />
          <stop offset="1" stopColor="#a8781f" />
        </linearGradient>
      </defs>
      <path d="M32 7c0 0-7 7.8-7 12.4a7 7 0 0 0 14 0C39 14.8 32 7 32 7z" fill={fill} />
      <path d="M25.5 28h13l3.5 9h-20z" fill={fill} />
      <path d="M12.5 41h14l3.5 10h-21zM37.5 41h14l3.5 10h-21z" fill={fill} />
    </svg>
  );
}

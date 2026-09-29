import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * โลโก้ร้าน (SVG ล้วน ไม่มีไฟล์รูป ไม่โหลดอะไรจากภายนอก) — หยดทองหลอมเหนือทองแท่ง 3 ก้อน (ทรงพีระมิด) บนพื้นดำมุมมน
 * วาดใหม่จากไอคอนของร้าน · ถ้าเจ้าของส่งไฟล์ต้นฉบับมา (เช่น apps/web/public/brand/) ให้แทนที่ตัว SVG ในไฟล์นี้ที่เดียว
 * พื้นดำทั้งสองธีม (เป็นเครื่องหมายการค้า) — มีขอบบาง ๆ ให้แยกจาก sidebar โหมดมืด
 * ใช้ที่หัว sidebar (ตัวเลือกสาขา) และหน้า login · ข้างชื่อร้าน/สาขา = ประดับ (aria-hidden) · อยู่เดี่ยว ๆ ส่ง `label`
 */
export function BrandMark({ className, label }: { className?: string; label?: string }) {
  // id ไม่ซ้ำต่อ instance — หน้าเดียวมีโลโก้ได้หลายที่
  const base = useId();
  const gold = `${base}-gold`;
  const shine = `${base}-shine`;
  const fill = `url(#${gold})`;
  return (
    <svg
      viewBox="0 0 64 64"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      focusable="false"
      data-slot="brand-mark"
      className={cn("shrink-0 rounded-[22%] bg-neutral-950 ring-1 ring-white/15", className)}
    >
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbe7a6" />
          <stop offset="0.55" stopColor="#dcae48" />
          <stop offset="1" stopColor="#a8781f" />
        </linearGradient>
        <linearGradient id={shine} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff6d6" stopOpacity="0.7" />
          <stop offset="1" stopColor="#fff6d6" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* หยดทอง */}
      <path d="M32 7c0 0-7 7.8-7 12.4a7 7 0 0 0 14 0C39 14.8 32 7 32 7z" fill={fill} />
      {/* ทองแท่ง: บน 1 ก้อน · ล่าง 2 ก้อน (หน้าตัดคางหมู) + แสงสะท้อนบนสันแท่ง */}
      <path d="M25.5 28h13l3.5 9h-20z" fill={fill} />
      <path d="M12.5 41h14l3.5 10h-21zM37.5 41h14l3.5 10h-21z" fill={fill} />
      <path d="M25.5 28h13l0.8 2h-14.6zM12.5 41h14l0.8 2h-15.6zM37.5 41h14l0.8 2h-15.6z" fill={`url(#${shine})`} />
    </svg>
  );
}

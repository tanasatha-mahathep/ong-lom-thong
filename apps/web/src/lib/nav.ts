import {
  Boxes,
  ChartColumn,
  Coins,
  FileArchive,
  HandCoins,
  House,
  type LucideIcon,
  ReceiptText,
  Users,
} from "lucide-react";
import type { Role } from "@/lib/queries";
import type { FileRouteTypes } from "@/routeTree.gen";

export type AppPath = FileRouteTypes["to"];

export interface NavItem {
  title: string;
  to: AppPath;
  icon: LucideIcon;
  /** role ที่เห็นเมนูนี้ — ไม่ระบุ = ทุก role */
  roles?: readonly Role[];
}

export interface NavGroup {
  /** ไม่มีชื่อ = กลุ่มเมนูหลักด้านบน */
  title?: string;
  items: readonly NavItem[];
}

/** ซื้อเข้า = เปิดบิล — ฝ่ายบัญชีเปิดบิลไม่ได้ (spec §10) */
const BILL_CREATORS: readonly Role[] = ["staff", "manager", "admin"];
/** ตั้งราคาทองวันนี้ — PUT /api/gold-price/today รับเฉพาะ manager/admin */
const GOLD_PRICE_SETTERS: readonly Role[] = ["manager", "admin"];

const NAV: readonly NavGroup[] = [
  {
    items: [
      { title: "หน้าแรก", to: "/", icon: House },
      { title: "ซื้อเข้า", to: "/buy", icon: HandCoins, roles: BILL_CREATORS },
      { title: "ค้นบิล", to: "/bills", icon: ReceiptText },
      { title: "ลูกค้า", to: "/customers", icon: Users },
    ],
  },
  {
    title: "รายงาน",
    items: [
      { title: "ยอดซื้อ", to: "/reports/purchase", icon: ChartColumn },
      { title: "สต็อก", to: "/reports/stock", icon: Boxes },
      { title: "ส่งบัญชีรายเดือน", to: "/reports/export", icon: FileArchive, roles: ["accounting", "admin"] },
    ],
  },
  {
    title: "ตั้งค่า",
    items: [{ title: "ราคาทองวันนี้", to: "/settings/gold-price", icon: Coins, roles: GOLD_PRICE_SETTERS }],
  },
];

/**
 * เมนูที่ role นี้เห็น — ซ่อนเพื่อความสะดวกเท่านั้น เซิร์ฟเวอร์ตรวจสิทธิ์ทุก endpoint อยู่แล้ว
 * กลุ่มที่ไม่เหลือเมนูถูกตัดทิ้ง
 */
export function navFor(role: Role): NavGroup[] {
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || item.roles.includes(role)),
  })).filter((group) => group.items.length > 0);
}

export const canCreateBill = (role: Role) => BILL_CREATORS.includes(role);
export const canSetGoldPrice = (role: Role) => GOLD_PRICE_SETTERS.includes(role);

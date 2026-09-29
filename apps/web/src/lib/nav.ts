import {
  Boxes,
  ChartColumn,
  Coins,
  FileArchive,
  HandCoins,
  House,
  type LucideIcon,
  ReceiptText,
  Store,
  UserCog,
  Users,
} from "lucide-react";
import type shellLocale from "@/i18n/locales/th";
import type { Role } from "@/lib/queries";
import type { FileRouteTypes } from "@/routeTree.gen";

export type AppPath = FileRouteTypes["to"];

/** key ใน namespace `shell` — ข้อความอยู่ใน src/i18n/locales/th.ts */
type NavKey = keyof (typeof shellLocale)["shell"]["nav"];
type GroupKey = keyof (typeof shellLocale)["shell"]["groups"];

export interface NavItem {
  title: NavKey;
  to: AppPath;
  icon: LucideIcon;
  /** role ที่เห็นเมนูนี้ — ไม่ระบุ = ทุก role */
  roles?: readonly Role[];
}

export interface NavGroup {
  /** ไม่มีชื่อ = กลุ่มเมนูหลักด้านบน */
  title?: GroupKey;
  items: readonly NavItem[];
}

/** ซื้อเข้า = เปิดบิล — ฝ่ายบัญชีเปิดบิลไม่ได้ (spec §10) */
const BILL_CREATORS: readonly Role[] = ["staff", "manager", "admin"];
/** ตั้งราคาทองวันนี้ — PUT /api/gold-price/today รับเฉพาะ manager/admin */
const GOLD_PRICE_SETTERS: readonly Role[] = ["manager", "admin"];
/** รายงานยอดซื้อ/สต็อก — พนักงานหน้าร้านไม่เห็นกลุ่มรายงาน */
const REPORT_READERS: readonly Role[] = ["manager", "accounting", "admin"];
/** ส่งบัญชีรายเดือน — POST /api/reports/export (spec §5) */
const EXPORTERS: readonly Role[] = ["accounting", "admin"];
/** จัดการสาขาและผู้ใช้ (หลายสาขา — เฟส 1) */
const ADMINS: readonly Role[] = ["admin"];

const NAV: readonly NavGroup[] = [
  {
    items: [
      { title: "home", to: "/", icon: House },
      { title: "buy", to: "/buy", icon: HandCoins, roles: BILL_CREATORS },
      { title: "bills", to: "/bills", icon: ReceiptText },
      { title: "customers", to: "/customers", icon: Users },
    ],
  },
  {
    title: "reports",
    items: [
      { title: "purchase", to: "/reports/purchase", icon: ChartColumn, roles: REPORT_READERS },
      { title: "stock", to: "/reports/stock", icon: Boxes, roles: REPORT_READERS },
      { title: "export", to: "/reports/export", icon: FileArchive, roles: EXPORTERS },
    ],
  },
  {
    title: "settings",
    items: [
      { title: "goldPrice", to: "/settings/gold-price", icon: Coins, roles: GOLD_PRICE_SETTERS },
      { title: "branches", to: "/settings/branches", icon: Store, roles: ADMINS },
      { title: "users", to: "/settings/users", icon: UserCog, roles: ADMINS },
    ],
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
/** ส่งบัญชีรายเดือน — GET /api/reports/export รับเฉพาะ accounting/admin (role อื่นเห็นสถานะไม่มีสิทธิ์แทนฟอร์ม) */
export const canExportReports = (role: Role) => EXPORTERS.includes(role);

/** หน้าเอกสารบิล (/buy/$id) เป็นของเมนู "ค้นบิล" ไม่ใช่ "ซื้อเข้า" (ซื้อเข้า = เปิดบิลใหม่เท่านั้น) */
const BILL_PAGE = /^\/buy\/[^/]+/;

/**
 * เมนูที่ตรงกับหน้าปัจจุบัน (มีได้เมนูเดียว) — "/" ตรงตัวเท่านั้น · หน้าลูกเป็นของเมนูแม่ที่ path ยาวที่สุด
 * (/customers/new → ลูกค้า · /reports/stock → สต็อก) · /buy/$id → ค้นบิล
 */
export function activeNavPath(pathname: string, role: Role): AppPath | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const items = navFor(role).flatMap((group) => group.items);
  if (BILL_PAGE.test(path)) return items.find((item) => item.to === "/bills")?.to;
  let best: AppPath | undefined;
  for (const item of items) {
    const hit = item.to === "/" ? path === "/" : path === item.to || path.startsWith(`${item.to}/`);
    if (hit && (!best || item.to.length > best.length)) best = item.to;
  }
  return best;
}

import { FilePlus2, type LucideIcon, UserPlus } from "lucide-react";
import type shellLocale from "@/i18n/locales/th";
import { type AppPath, type NavItem, canCreateBill, navFor } from "@/lib/nav";
import type { Role } from "@/lib/queries";

/**
 * รายการในหน้าค้นหา (Ctrl/⌘+K) ที่ไม่ต้องถาม API — หน้าในเมนูและทางลัด ตามสิทธิ์ของ role (ชุดเดียวกับเมนูใน sidebar)
 * ซ่อนเพื่อความสะดวกเท่านั้น เซิร์ฟเวอร์ตรวจสิทธิ์ทุก endpoint อยู่แล้ว
 */

type GroupKey = keyof (typeof shellLocale)["shell"]["groups"];
type ActionKey = keyof (typeof shellLocale)["shell"]["search"]["actions"];

export interface SearchPage {
  item: NavItem;
  /** กลุ่มเมนู (รายงาน · ตั้งค่า) — ไม่มี = เมนูหลัก */
  group?: GroupKey;
}

export interface SearchAction {
  /** key ใน `shell.search.actions` */
  key: ActionKey;
  to: AppPath;
  icon: LucideIcon;
  /** เมนูที่เกี่ยวข้อง — ชื่อเมนูใช้เป็นคำค้นด้วย (พิมพ์ "ซื้อเข้า" เจอ "เปิดบิลใหม่") */
  related: NavItem["title"];
}

/** หน้าในเมนูที่ role นี้เข้าได้ ตามลำดับเมนู */
export function searchPagesFor(role: Role): SearchPage[] {
  return navFor(role).flatMap((group) => group.items.map((item) => ({ item, group: group.title })));
}

/** ทางลัด: เปิดบิลใหม่ (เฉพาะผู้เปิดบิลได้ — ฝ่ายบัญชีไม่ได้) · เพิ่มลูกค้า (ทุก role เหมือนปุ่มในหน้าลูกค้า) */
export function searchActionsFor(role: Role): SearchAction[] {
  const actions: SearchAction[] = [];
  if (canCreateBill(role)) actions.push({ key: "newBill", to: "/buy", icon: FilePlus2, related: "buy" });
  actions.push({ key: "newCustomer", to: "/customers/new", icon: UserPlus, related: "customers" });
  return actions;
}

/** ข้อความสำหรับเทียบ: รูป Unicode เดียวกัน (NFC) · ตัวพิมพ์เล็ก · ช่องว่างซ้อน/หัวท้ายตัดทิ้ง */
export function normalizeForMatch(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * ทุกคำในคำค้น (คั่นด้วยช่องว่าง) ต้องพบในข้อความชุดนี้ — "รายงาน ซื้อ" เจอ "ยอดซื้อ" ในกลุ่มรายงาน · คำค้นว่าง = ตรงทุกอย่าง
 * ภาษาไทยไม่เว้นวรรคระหว่างคำ จึงเทียบแบบมีอยู่ในข้อความ (ไม่ใช่ขึ้นต้นคำ)
 */
export function matchesQuery(query: string, texts: readonly string[]): boolean {
  const words = normalizeForMatch(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = texts.map(normalizeForMatch).join(" ");
  return words.every((word) => haystack.includes(word));
}

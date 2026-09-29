import AxeBuilder from "@axe-core/playwright";
import { type Page, expect } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * รอ CSS transition/animation ที่มีจุดจบให้จบก่อนวัด — ถ้า axe วัดระหว่างปุ่มเปลี่ยนสถานะ (เช่น ปุ่มบันทึกจาก
 * aria-disabled เป็นพร้อมกด) จะได้สีกลางทาง ไม่ใช่สีจริงที่ผู้ใช้เห็นเมื่อหน้าจอนิ่ง · animation ที่วนไม่รู้จบ (ไอคอนหมุน) ไม่ต้องรอ
 */
async function settleAnimations(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== "running" || a.effect?.getComputedTiming().endTime === Infinity),
  );
}

/**
 * WCAG 2.2 AA ด้วย axe — แสดงเฉพาะ rule + element ที่ผิดให้อ่านง่าย
 * .ong-watermark: ลายน้ำ "ตัวอย่าง" ของ staging บนใบรับซื้อ (aria-hidden) ไม่ใช่ UI ที่ต้องตรวจ
 */
export async function expectAccessible(page: Page) {
  await settleAnimations(page);
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).exclude(".ong-watermark").analyze();
  expect(violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.target.join(" ")) }))).toEqual([]);
}

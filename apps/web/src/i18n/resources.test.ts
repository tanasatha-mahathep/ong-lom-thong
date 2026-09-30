import { describe, expect, it } from "vitest";
import { resources } from "./resources";
import { resourcesEn } from "./resources.en";

type Tree = { [key: string]: string | Tree };

/** "a.b.c" → ข้อความ ของทุกใบ */
function leaves(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [p, v] of leaves(value, path)) out.set(p, v);
  }
  return out;
}

/** ตัวแปร {{name}} ในข้อความ */
const variables = (text: string) => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

const th = resources.th as unknown as Record<string, Tree>;
const en = resourcesEn as unknown as Record<string, Tree>;

describe("ข้อความภาษาอังกฤษครบเท่าภาษาไทย", () => {
  it("namespace เท่ากัน", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(th).sort());
  });

  it.each(Object.keys(th))("namespace %s: key ตรงกันทุกตัว · ไม่มีข้อความว่าง · ตัวแปร {{…}} ตรงกัน", (ns) => {
    const thLeaves = leaves(th[ns] ?? {});
    const enLeaves = leaves(en[ns] ?? {});
    expect([...enLeaves.keys()].sort()).toEqual([...thLeaves.keys()].sort());
    for (const [key, thText] of thLeaves) {
      const enText = enLeaves.get(key) ?? "";
      expect(enText.trim(), `${ns}.${key} ว่าง`).not.toBe("");
      expect(variables(enText), `${ns}.${key} ตัวแปรไม่ตรง`).toEqual(variables(thText));
    }
  });

  it("ภาษาอังกฤษไม่ได้คัดลอกภาษาไทยมาทั้งก้อน (ข้อความไทยเหลือเฉพาะที่ตั้งใจ)", () => {
    // ตั้งใจคงภาษาไทย: รูปแบบวันที่ พ.ศ. · ชื่อภาษา · ชื่อไฟล์บัญชี · ปุ่มของ Siam ID · ป้ายสองภาษา
    const allowed = /วว\/ดด\/ปปปป|มกราคม 2540|เปิดใช้บัตรกับระบบงาน|รายงานยอดซื้อ_|สต็อกคงเหลือ_|ภาษา/;
    const thai = /[฀-๿]/;
    const leaked = Object.entries(en).flatMap(([ns, tree]) =>
      [...leaves(tree)].filter(([, text]) => thai.test(text) && !allowed.test(text)).map(([key]) => `${ns}.${key}`),
    );
    expect(leaked).toEqual([]);
  });
});

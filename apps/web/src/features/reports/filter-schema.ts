import type { TFunction } from "i18next";
import { z } from "zod";
import { parseDateField } from "@/lib/thai-date";

type CommonT = TFunction<"common">;

/**
 * ตรวจช่องวันที่ (พ.ศ. ที่พิมพ์) ก่อนส่ง (U2) — ข้อความ error ชุดเดียวกับทุกหน้า (common.dateField)
 * คืน ISO ค.ศ. ของแต่ละช่อง (ตัวแปรที่อ่านไม่ได้ = ไม่มี) และใส่ issue ตาม path ของช่องนั้น
 * from > to → error ที่ช่อง `to` (ช่วงกลับด้าน) เฉพาะเมื่อทั้งสองช่องอ่านได้
 */
function checkDates(
  t: CommonT,
  ctx: z.RefinementCtx,
  input: unknown,
  dates: { field: string; text: string }[],
  range?: { from: string; to: string },
): Record<string, string> | null {
  const iso: Record<string, string> = {};
  let ok = true;
  for (const { field, text } of dates) {
    const parsed = parseDateField(text);
    if ("error" in parsed) {
      ctx.issues.push({ code: "custom", input, path: [field], message: t(`dateField.${parsed.error}`) });
      ok = false;
    } else {
      iso[field] = parsed.iso;
    }
  }
  if (ok && range) {
    const from = iso[range.from];
    const to = iso[range.to];
    if (from !== undefined && to !== undefined && from > to) {
      ctx.issues.push({ code: "custom", input, path: [range.to], message: t("dateField.range") });
      ok = false;
    }
  }
  return ok ? iso : null;
}

/** ตัวกรองรายงานยอดซื้อ — ชื่อช่องตรงกับ query ของ API (date_from · date_to · metal · branch_id) */
export const purchaseFilterSchema = (t: CommonT) =>
  z
    .object({ date_from: z.string(), date_to: z.string(), metal: z.string(), branch_id: z.string() })
    .transform((values, ctx) => {
      const iso = checkDates(
        t,
        ctx,
        values,
        [
          { field: "date_from", text: values.date_from },
          { field: "date_to", text: values.date_to },
        ],
        { from: "date_from", to: "date_to" },
      );
      if (!iso) return z.NEVER;
      return {
        date_from: iso.date_from ?? "",
        date_to: iso.date_to ?? "",
        metal: values.metal,
        branch_id: values.branch_id,
      };
    });

/** ตัวกรองสต็อกคงเหลือ — `as_of` (ณ วันที่) + branch_id */
export const stockFilterSchema = (t: CommonT) =>
  z.object({ as_of: z.string(), branch_id: z.string() }).transform((values, ctx) => {
    const iso = checkDates(t, ctx, values, [{ field: "as_of", text: values.as_of }]);
    if (!iso) return z.NEVER;
    return { as_of: iso.as_of ?? "", branch_id: values.branch_id };
  });

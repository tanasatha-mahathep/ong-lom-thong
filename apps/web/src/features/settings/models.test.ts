import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { BRANCHES, BRANCH_2, CLOSED, CLOSED_ID, HQ, HQ_ID, STAFF } from "@/test/admin";
import {
  branchValuesOf,
  checkCode,
  checkDocPrefix,
  checkSortOrder,
  checkTaxCode,
  needsCloseConfirm,
  newBranchValues,
  toBranchCreate,
  toBranchUpdate,
} from "./branch-model";
import { saveErrorOf } from "./errors";
import {
  NEW_USER,
  checkEmail,
  checkPassword,
  hasNoBranch,
  selectableBranches,
  toUserCreate,
  toUserUpdate,
  userValuesOf,
} from "./user-model";

describe("ฟอร์มสาขา → payload ของ API", () => {
  it("เพิ่ม: ตัดช่องว่าง · ช่องไม่บังคับที่ว่าง = null · ลำดับเป็นจำนวนเต็ม", () => {
    const values = {
      ...newBranchValues(BRANCHES),
      code: " 00003 ",
      name: " สาขาทดสอบ 3 ",
      tax_branch_code: "",
      doc_prefix: "AB",
      address: "   ",
    };
    expect(toBranchCreate(values)).toEqual({
      code: "00003",
      name: "สาขาทดสอบ 3",
      short_name: null,
      tax_branch_code: null,
      address: null,
      tel: null,
      doc_prefix: "AB",
      sort_order: 3,
      is_active: true,
    });
  });

  it("สาขาใหม่ต่อท้ายลำดับเดิม · ยังไม่มีสาขา = 0", () => {
    expect(newBranchValues(BRANCHES).sort_order).toBe("3");
    expect(newBranchValues([]).sort_order).toBe("0");
  });

  it("แก้: ไม่ส่ง code · สาขาที่มีบิลไม่ส่ง doc_prefix · ยังไม่มีบิลส่ง (ว่าง = null)", () => {
    expect(toBranchUpdate(branchValuesOf(HQ), HQ)).not.toHaveProperty("code");
    expect(toBranchUpdate(branchValuesOf(HQ), HQ)).not.toHaveProperty("doc_prefix");
    expect(toBranchUpdate({ ...branchValuesOf(BRANCH_2), doc_prefix: "" }, BRANCH_2)).toMatchObject({
      doc_prefix: null,
    });
  });

  it("ยืนยันก่อนปิดเฉพาะสาขาที่เปิดอยู่และมีบิลแล้ว", () => {
    const closing = (branch: typeof HQ) => ({ ...branchValuesOf(branch), is_active: false });
    expect(needsCloseConfirm(HQ, closing(HQ))).toBe(true);
    expect(needsCloseConfirm(BRANCH_2, closing(BRANCH_2))).toBe(false);
    expect(needsCloseConfirm(HQ, branchValuesOf(HQ))).toBe(false);
    expect(needsCloseConfirm(undefined, closing(HQ))).toBe(false);
  });

  it("ตรวจรูปแบบเดียวกับ API: รหัส 5 หลัก · อักษรนำ A–Z 1–4 · ลำดับ 0–9999", () => {
    expect(checkCode({ value: "00001" })).toBeUndefined();
    expect(checkCode({ value: "0001" })).toBe("branches.validation.code");
    expect(checkTaxCode({ value: "" })).toBeUndefined();
    expect(checkTaxCode({ value: "1234a" })).toBe("branches.validation.taxCode");
    expect(checkDocPrefix({ value: "PTKK" })).toBeUndefined();
    expect(checkDocPrefix({ value: "PTKKX" })).toBe("branches.validation.docPrefix");
    expect(checkDocPrefix({ value: "pt" })).toBe("branches.validation.docPrefix");
    expect(checkSortOrder({ value: "9999" })).toBeUndefined();
    expect(checkSortOrder({ value: "10000" })).toBe("branches.validation.sortOrder");
    expect(checkSortOrder({ value: "-1" })).toBe("branches.validation.sortOrder");
  });
});

describe("ฟอร์มผู้ใช้ → payload ของ API", () => {
  it("เพิ่ม: ไม่มีรหัสผ่าน = ไม่ส่ง (ระบบสุ่ม) · ไม่มีสาขาหลัก = null · สาขาที่อนุญาตไม่ซ้ำ", () => {
    const values = {
      ...NEW_USER,
      name: " ผู้ใช้ทดสอบ ",
      email: " tester@local.test ",
      allowed_branch_ids: [HQ_ID, HQ_ID],
    };
    expect(toUserCreate(values)).toEqual({
      email: "tester@local.test",
      name: "ผู้ใช้ทดสอบ",
      role: "staff",
      branch_id: null,
      allowed_branch_ids: [HQ_ID],
      can_view_all: false,
    });
    // รหัสผ่านที่ตั้งเองส่งตามที่พิมพ์ (ไม่ตัดช่องว่าง)
    expect(toUserCreate({ ...values, password: " pass word 1 " })).toMatchObject({ password: " pass word 1 " });
  });

  it("แก้บัญชีตัวเอง: ไม่ส่ง role/is_active · บัญชีอื่นส่ง", () => {
    const values = userValuesOf(STAFF);
    expect(toUserUpdate(values, true)).not.toHaveProperty("role");
    expect(toUserUpdate(values, true)).not.toHaveProperty("is_active");
    expect(toUserUpdate(values, false)).toMatchObject({ role: "staff", is_active: true });
  });

  it("สาขาที่เลือกได้: เปิดอยู่ทั้งหมด + ที่ปิดแล้วแต่ยังผูกอยู่", () => {
    expect(selectableBranches(BRANCHES, []).map((b) => b.id)).toEqual([HQ.id, BRANCH_2.id]);
    expect(selectableBranches(BRANCHES, [CLOSED_ID]).map((b) => b.id)).toEqual([HQ.id, BRANCH_2.id, CLOSED.id]);
  });

  it("เตือนเมื่อไม่มีสาขาให้ทำงานเลย · รหัสผ่าน 10–128 ตัว (ว่างได้) · อีเมลคร่าว ๆ", () => {
    expect(hasNoBranch(NEW_USER)).toBe(true);
    expect(hasNoBranch({ ...NEW_USER, can_view_all: true })).toBe(false);
    expect(hasNoBranch({ ...NEW_USER, allowed_branch_ids: [HQ_ID] })).toBe(false);
    expect(checkPassword({ value: "" })).toBeUndefined();
    expect(checkPassword({ value: "123456789" })).toBe("users.validation.passwordShort");
    expect(checkPassword({ value: "x".repeat(129) })).toBe("users.validation.passwordLong");
    expect(checkEmail({ value: "tester@local.test" })).toBeUndefined();
    expect(checkEmail({ value: "tester@" })).toBe("users.validation.email");
  });
});

describe("error จาก API → ช่องในฟอร์ม", () => {
  const fields = ["email", "allowed_branch_ids"] as const;

  it("ข้อความไทยของ API แสดงตรง ๆ ใต้ช่องที่ชี้ · allowed_branch_ids.N → ช่องรายการสาขา", () => {
    const closed = "สาขา 00002 สาขาทดสอบปิด ปิดอยู่ — เปิดสาขาก่อนหรือเลือกสาขาอื่น";
    expect(saveErrorOf(new ApiError(400, closed, "allowed_branch_ids.1", null), fields)).toEqual({
      field: "allowed_branch_ids",
      forbidden: false,
      message: closed,
    });
  });

  it("ช่องที่ฟอร์มไม่มี = ข้อความรวม · 403 = forbidden", () => {
    expect(saveErrorOf(new ApiError(400, "ไม่รู้จักช่อง foo", "foo", null), fields).field).toBeUndefined();
    expect(saveErrorOf(new ApiError(403, "forbidden", undefined, null), fields).forbidden).toBe(true);
    expect(saveErrorOf(new Error("boom"), fields)).toMatchObject({ field: undefined, forbidden: false });
  });
});

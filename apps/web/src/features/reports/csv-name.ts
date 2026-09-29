/** ส่วนท้ายชื่อไฟล์สำรอง: `_รหัสสาขา` (เมื่อกรองสาขา) `_โลหะ` (เมื่อกรองโลหะ) — สองสาขาช่วงเดียวกันต้องไม่ชื่อซ้ำ */
export function csvNameSuffix(branchCode: string | undefined, metal: string | undefined): string {
  const clean = (text: string) => text.replace(/[^A-Za-z0-9-]/g, "");
  return `${branchCode ? `_${clean(branchCode)}` : ""}${metal ? `_${clean(metal)}` : ""}`;
}

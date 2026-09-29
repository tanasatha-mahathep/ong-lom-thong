import { ApiError, errorMessage } from "@/lib/api";

/** 400 ของ API ที่ชี้ช่องของตัวกรอง (`field` = ชื่อ query: date_from · date_to · as_of · metal · branch_id) — แสดงใต้ช่องนั้น (U3) */
export interface FieldProblem {
  field: string;
  message: string;
}

const FILTER_FIELDS = new Set(["date_from", "date_to", "as_of", "metal", "branch_id"]);

export function fieldProblem(error: unknown): FieldProblem | undefined {
  if (!(error instanceof ApiError) || error.status !== 400 || !error.field || !FILTER_FIELDS.has(error.field)) {
    return undefined;
  }
  return { field: error.field, message: errorMessage(error) };
}

export const problemOf = (problem: FieldProblem | undefined, field: string) =>
  problem?.field === field ? problem.message : undefined;

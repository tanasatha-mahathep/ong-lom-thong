// @ong/core/consignment — ขายฝาก/ไถ่ถอน · แยก subpath เพราะชื่อทั่วไป (quote · addMonths) ไม่ควรปนใน @ong/core หลัก
export {
  DEFAULT_FEE_RATE,
  DEFAULT_INTEREST_RATE,
  DEFAULT_VAT_RATE,
  addMonths,
  monthsDaysBetween,
  quote,
  type ConsignmentQuote,
  type ConsignmentQuoteInput,
  type HoldPeriod,
} from "./interest";

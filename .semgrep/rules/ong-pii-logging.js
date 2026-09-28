// Fixture for ong-pii-logging.yml — run: semgrep --test .semgrep/rules (not application code)
import { maskNationalId } from "@ong/core";

export function logCustomer(row, input, nationalId) {
  // ruleid: ong-national-id-in-log
  console.log("customer", row.nationalId);
  // ruleid: ong-national-id-in-log
  console.error(`duplicate ${input.national_id}`);
  // ruleid: ong-national-id-in-log
  console.warn({ id: row.id, nationalId });
  // ok: ong-national-id-in-log
  console.log("nationalId must be 13 digits");
  // ok: ong-national-id-in-log
  console.log("customer", row.id, maskNationalId(row.nationalId));
  // ok: ong-national-id-in-log
  console.log("customer", row.id, row.nameTh);
}

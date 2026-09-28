import { describe, expect, it } from "vitest";
import { makeBill } from "@/test/bill-fixture";
import { PDF_POLL_WINDOW_MS, awaitingFilePoll } from "./bill-api";

const NOW = Date.parse("2026-09-29T08:00:00.000Z");

describe("awaitingFilePoll", () => {
  it("keeps polling the original PDF within two minutes of created_at", () => {
    const bill = makeBill({ pdf_status: "pending", created_at: new Date(NOW - 60_000).toISOString() });
    expect(awaitingFilePoll(bill, NOW)).toBe(true);
  });

  it("stops polling the original PDF once two minutes from created_at have passed", () => {
    const bill = makeBill({ pdf_status: "pending", created_at: new Date(NOW - PDF_POLL_WINDOW_MS).toISOString() });
    expect(awaitingFilePoll(bill, NOW)).toBe(false);
  });

  // S5: a bill can be voided long after it was created — anchoring the void file's window on the old
  // created_at made the app give up on it immediately, even though the void PDF had just started generating.
  it("keeps polling the void PDF from voided_at, not the older created_at (S5)", () => {
    const bill = makeBill({
      status: "void",
      pdf_status: "ready",
      void_pdf_status: "pending",
      created_at: "2026-09-01T00:00:00.000Z",
      voided_at: new Date(NOW - 60_000).toISOString(),
    });
    expect(awaitingFilePoll(bill, NOW)).toBe(true);
  });

  it("stops polling the void PDF once two minutes from voided_at have passed", () => {
    const bill = makeBill({
      status: "void",
      pdf_status: "ready",
      void_pdf_status: "pending",
      created_at: "2026-09-01T00:00:00.000Z",
      voided_at: new Date(NOW - PDF_POLL_WINDOW_MS).toISOString(),
    });
    expect(awaitingFilePoll(bill, NOW)).toBe(false);
  });

  it("does not poll once every file is resolved", () => {
    const bill = makeBill({ pdf_status: "ready", idcard_status: "ready", void_pdf_status: "none" });
    expect(awaitingFilePoll(bill, NOW)).toBe(false);
  });
});

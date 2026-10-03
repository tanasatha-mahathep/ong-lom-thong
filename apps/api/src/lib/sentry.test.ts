import type { ErrorEvent } from "@sentry/node";
import { describe, expect, it } from "vitest";
import { captureError, initSentry, scrubEvent, scrubText } from "./sentry";

const ID = "1670101304032";
const ID_SPACED = "1 6701 01304 03 2";
const PHONE = "0654249514";

describe("scrubText — ปิดบังเลขยาว (PDPA · R13)", () => {
  it("เลขบัตร 13 หลักทั้งแบบติดกันและแบบมีขีด/เว้นวรรคถูกปิด", () => {
    expect(scrubText(`id=${ID}`)).toBe("id=[ตัวเลขยาว]");
    expect(scrubText(ID_SPACED)).toBe("[ตัวเลขยาว]");
    expect(scrubText("1-6701-01304-03-2")).toBe("[ตัวเลขยาว]");
  });

  it("เบอร์โทรถูกปิด", () => {
    expect(scrubText(`tel ${PHONE}`)).toBe("tel [ตัวเลขยาว]");
  });

  it("เลขสั้นและวันที่ไม่ถูกปิด — ยังอ่าน error ได้", () => {
    expect(scrubText("status 500 at 2026-10-03")).toBe("status 500 at 2026-10-03");
    expect(scrubText("bill #12345678")).toBe("bill #12345678");
  });
});

describe("scrubEvent", () => {
  it("ตัด request · user ทิ้ง และปิดบังทุกข้อความที่เป็นสตริง", () => {
    const event: ErrorEvent = {
      type: undefined,
      message: `failed for ${ID}`,
      request: { url: `https://x/api/customers?id=${ID}`, data: `{"id":"${ID}"}` },
      user: { ip_address: "1.2.3.4", email: "a@b.c" },
      exception: { values: [{ type: "Error", value: `bad ${PHONE}` }] },
      extra: { nested: { national: ID }, count: 3 },
    };
    const out = scrubEvent(event);
    expect(out.request).toBeUndefined();
    expect(out.user).toBeUndefined();
    expect(out.message).toBe("failed for [ตัวเลขยาว]");
    expect(out.exception?.values?.[0]?.value).toBe("bad [ตัวเลขยาว]");
    expect(out.extra).toEqual({ nested: { national: "[ตัวเลขยาว]" }, count: 3 });
    expect(JSON.stringify(out)).not.toContain(ID);
    expect(JSON.stringify(out)).not.toContain(PHONE);
  });

  it("breadcrumb ของ HTTP ตัด query string และปิดบังข้อความ", () => {
    const event: ErrorEvent = {
      type: undefined,
      breadcrumbs: [
        { category: "http", data: { url: `https://s3.example/bill?key=${ID}`, method: "GET" } },
        { category: "console", message: `saw ${ID}` },
      ],
    };
    const [httpCrumb, consoleCrumb] = scrubEvent(event).breadcrumbs ?? [];
    expect(httpCrumb?.data).toEqual({ url: "https://s3.example/bill", method: "GET" });
    expect(consoleCrumb?.message).toBe("saw [ตัวเลขยาว]");
  });

  it("event ที่ไม่มีข้อมูลเพิ่มเติม ไม่พัง", () => {
    expect(scrubEvent({ type: undefined })).toEqual({ type: undefined });
  });
});

describe("initSentry / captureError", () => {
  it("ไม่ตั้ง DSN = ไม่เปิด และ captureError ไม่พัง", () => {
    expect(initSentry({ dsn: undefined, environment: "test" })).toBe(false);
    expect(() => captureError(new Error(`ยังไม่เปิด ${ID}`))).not.toThrow();
  });
});

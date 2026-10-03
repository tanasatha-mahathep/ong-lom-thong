import type { ErrorEvent } from "@sentry/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initErrorTracking, scrubEvent, scrubText } from "./error-tracking";

const ID = "1670101304032";
const PHONE = "0654249514";

describe("scrubText — ปิดบังเลขยาว (PDPA)", () => {
  it("เลขบัตรประชาชนทั้งแบบติดกันและมีขีด/เว้นวรรคถูกปิด", () => {
    expect(scrubText(`id ${ID}`)).toBe("id [ตัวเลขยาว]");
    expect(scrubText("1 6701 01304 03 2")).toBe("[ตัวเลขยาว]");
    expect(scrubText("1-6701-01304-03-2")).toBe("[ตัวเลขยาว]");
  });

  it("เบอร์โทรถูกปิด เลขสั้นและวันที่ไม่ถูกปิด", () => {
    expect(scrubText(`tel ${PHONE}`)).toBe("tel [ตัวเลขยาว]");
    expect(scrubText("status 500 at 2026-10-03")).toBe("status 500 at 2026-10-03");
  });
});

describe("scrubEvent", () => {
  it("ตัด request และผู้ใช้ทิ้ง แล้วปิดบังข้อความ", () => {
    const event: ErrorEvent = {
      type: undefined,
      message: `พบ ${ID}`,
      request: { url: `https://x/buy?id=${ID}` },
      user: { ip_address: "1.2.3.4" },
      exception: { values: [{ type: "Error", value: `tel ${PHONE}` }] },
    };
    const out = scrubEvent(event);
    expect(out.request).toBeUndefined();
    expect(out.user).toBeUndefined();
    expect(out.message).toBe("พบ [ตัวเลขยาว]");
    expect(out.exception?.values?.[0]?.value).toBe("tel [ตัวเลขยาว]");
    expect(JSON.stringify(out)).not.toContain(ID);
    expect(JSON.stringify(out)).not.toContain(PHONE);
  });

  it("breadcrumb ของ fetch ตัด query string และปิดบังข้อความ", () => {
    const event: ErrorEvent = {
      type: undefined,
      breadcrumbs: [
        { category: "fetch", data: { url: `/api/customers?nid=${ID}`, method: "GET" } },
        { category: "console", message: `saw ${ID}` },
      ],
    };
    const [fetchCrumb, consoleCrumb] = scrubEvent(event).breadcrumbs ?? [];
    expect(fetchCrumb?.data).toEqual({ url: "/api/customers", method: "GET" });
    expect(consoleCrumb?.message).toBe("saw [ตัวเลขยาว]");
  });
});

describe("initErrorTracking", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ไม่มี DSN = ไม่ทำอะไร และไม่โหลดไลบรารี", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");
    await expect(initErrorTracking()).resolves.toBeUndefined();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18next, { LANGUAGE_LOAD_TIMEOUT_MS, languageLoaders, setLanguage } from "@/i18n";
import { resources } from "./resources";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

/** ให้ภาษาอังกฤษต้องโหลดใหม่ (เทสต์ก่อนหน้าอาจโหลดไว้แล้ว) */
function forgetEnglish() {
  for (const ns of Object.keys(resources.th)) i18next.removeResourceBundle("en", ns);
}

const english = () => import("./resources.en").then((module) => module.resourcesEn);

describe("setLanguage — ไม่ค้าง · ตัวเลือกล่าสุดชนะ", () => {
  beforeEach(async () => {
    forgetEnglish();
    await i18next.changeLanguage("th");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("chunk ภาษาอังกฤษค้าง → reject หลัง 3 วินาที · ภาษายังเป็นไทย · ไม่จำค่า", async () => {
    vi.useFakeTimers();
    vi.spyOn(languageLoaders, "en").mockReturnValue(new Promise(() => undefined));
    const pending = setLanguage("en");
    const settled = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(LANGUAGE_LOAD_TIMEOUT_MS);
    await settled;
    expect(i18next.language).toBe("th");
    expect(localStorage.getItem("ong.lang")).toBeNull();
  });

  it("chunk โหลดไม่ได้ (หายหลัง deploy) → reject · ภาษายังเป็นไทย", async () => {
    vi.spyOn(languageLoaders, "en").mockRejectedValue(new Error("Failed to fetch dynamically imported module"));
    await expect(setLanguage("en")).rejects.toThrow(/dynamically imported/);
    expect(i18next.language).toBe("th");
  });

  it("เลือก English (โหลดช้า) แล้วเลือกไทยทันที → ไทยชนะ แม้ English โหลดเสร็จทีหลัง", async () => {
    const slow = deferred<Record<string, object>>();
    vi.spyOn(languageLoaders, "en").mockReturnValue(slow.promise);
    const first = setLanguage("en");
    await setLanguage("th");
    slow.resolve(await english());
    await first;

    expect(i18next.language).toBe("th");
    expect(localStorage.getItem("ong.lang")).toBe("th");
  });

  it("โหลดทันเวลา → เปลี่ยนภาษาและจำไว้", async () => {
    await setLanguage("en");
    expect(i18next.language).toBe("en");
    expect(localStorage.getItem("ong.lang")).toBe("en");
  });
});

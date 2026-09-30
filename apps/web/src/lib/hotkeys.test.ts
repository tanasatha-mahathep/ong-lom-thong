import { afterEach, describe, expect, it } from "vitest";
import { OPEN_LAYER, hasOpenLayer, isApplePlatform, isSearchShortcut, isTypingTarget } from "./hotkeys";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", { key: "k", code: "KeyK", ...init });

describe("isSearchShortcut — Ctrl/⌘+K ตามตำแหน่งปุ่ม", () => {
  it.each<[string, KeyboardEventInit]>([
    ["Ctrl+K", { ctrlKey: true }],
    ["⌘K", { metaKey: true }],
    ["แป้นไทย (key 'า' · code KeyK)", { ctrlKey: true, key: "า" }],
  ])("%s = ค้นหา", (_, init) => {
    expect(isSearchShortcut(key(init))).toBe(true);
  });

  it.each<[string, KeyboardEventInit]>([
    ["K เฉย ๆ", {}],
    ["Ctrl+Shift+K", { ctrlKey: true, shiftKey: true }],
    ["Ctrl+Alt+K (AltGr บางแป้น)", { ctrlKey: true, altKey: true }],
    ["กดค้าง", { ctrlKey: true, repeat: true }],
    ["ระหว่าง IME", { ctrlKey: true, isComposing: true }],
    ["ปุ่มอื่นที่ได้ key 'k' (แป้น Dvorak ฯลฯ)", { ctrlKey: true, code: "KeyT" }],
    ["'/' (ไม่มีปุ่มลัดนี้ — Siam ID พิมพ์ '/' ในวันที่)", { key: "/", code: "Slash" }],
  ])("%s ≠ ค้นหา", (_, init) => {
    expect(isSearchShortcut(key(init))).toBe(false);
  });
});

describe("isApplePlatform — ป้าย ⌘ หรือ Ctrl", () => {
  const nav = (platform: string, uaPlatform?: string) => ({
    platform,
    userAgentData: uaPlatform === undefined ? undefined : { platform: uaPlatform },
  });

  it.each([
    ["MacIntel", undefined, true],
    ["iPhone", undefined, true],
    ["iPad", undefined, true],
    ["Win32", undefined, false],
    ["Linux x86_64", undefined, false],
    ["", undefined, false],
    // Client Hints ก่อน navigator.platform
    ["", "macOS", true],
    ["MacIntel", "Windows", false],
  ])("platform %j · userAgentData %j → %s", (platform, uaPlatform, expected) => {
    expect(isApplePlatform(nav(platform, uaPlatform))).toBe(expected);
  });

  it("ไม่มี navigator (อ่านไม่ได้) = ไม่ใช่ Apple", () => {
    expect(isApplePlatform(undefined)).toBe(false);
  });
});

describe("hasOpenLayer — ชั้นที่เปิดทับหน้าอยู่", () => {
  const layers: HTMLElement[] = [];
  const add = (attributes: Record<string, string>) => {
    const layer = document.createElement("div");
    for (const [name, value] of Object.entries(attributes)) layer.setAttribute(name, value);
    document.body.append(layer);
    layers.push(layer);
    return layer;
  };
  afterEach(() => {
    for (const layer of layers.splice(0)) layer.remove();
  });

  it("ไม่มีชั้น = false", () => {
    expect(hasOpenLayer()).toBe(false);
  });

  it.each([
    ["alertdialog", { role: "alertdialog" }],
    ["เมนู", { role: "menu" }],
    ["dialog ของ Radix (ไม่มี aria-modal)", { role: "dialog", "data-state": "open" }],
    ["ชั้นบังหน้าจอ", { "data-slot": "blocking-overlay" }],
  ])("%s = true", (_, attributes) => {
    add(attributes);
    expect(hasOpenLayer()).toBe(true);
  });

  it("ชั้นที่กำลังเล่นท่าปิด (data-state=closed) และชั้นที่ยกเว้นไม่นับ", () => {
    add({ role: "dialog", "data-state": "closed" });
    const own = add({ role: "dialog", "data-state": "open" });
    expect(hasOpenLayer(own)).toBe(false);
  });
});

describe("ของเดิมที่ย้ายมาจาก use-branch-switch (พฤติกรรมเดิม)", () => {
  it("OPEN_LAYER ยังนับเฉพาะ dialog แบบ aria-modal · alertdialog · เมนู · ชั้นบังหน้าจอ", () => {
    expect(OPEN_LAYER).toBe(
      '[role="dialog"][aria-modal="true"], [role="alertdialog"], [role="menu"], [data-slot="blocking-overlay"]',
    );
  });

  it("isTypingTarget: ช่องกรอก · combobox · contenteditable", () => {
    const input = document.createElement("input");
    const combobox = document.createElement("div");
    combobox.setAttribute("role", "combobox");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect([input, combobox, editable].map(isTypingTarget)).toEqual([true, true, true]);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

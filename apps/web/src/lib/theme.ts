import { createContext, useContext } from "react";

export type Theme = "light" | "dark" | "system";
export const THEMES: readonly Theme[] = ["light", "dark", "system"];

/** ต้องตรงกับ public/theme-init.js (ตั้งธีมก่อน React โหลด) */
export const THEME_STORAGE_KEY = "ong.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export const isTheme = (value: unknown): value is Theme =>
  typeof value === "string" && (THEMES as readonly string[]).includes(value);

/** localStorage อาจใช้ไม่ได้ (โหมดส่วนตัว / ถูกบล็อก) — ใช้ค่าเริ่มต้น "system" แทน */
export function readStoredTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : "system";
  } catch {
    return "system";
  }
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // เก็บไม่ได้ก็ยังใช้ธีมนี้ได้จนปิดหน้า
  }
}

/** ใส่/ถอด class .dark ที่ <html> — color-scheme ของ control ตามมาจาก CSS (.dark · บนจอเท่านั้น) */
export function applyTheme(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia(DARK_QUERY).matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** ธีม "ตามระบบ" ต้องเปลี่ยนตามเมื่อผู้ใช้สลับโหมดของเครื่อง */
export function subscribeSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const ThemeContext = createContext<ThemeState | null>(null);

export function useTheme(): ThemeState {
  const state = useContext(ThemeContext);
  if (!state) throw new Error("useTheme ต้องอยู่ใต้ <ThemeProvider>");
  return state;
}

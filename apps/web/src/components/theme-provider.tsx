import { type ReactNode, useEffect, useMemo, useState } from "react";
import { type Theme, ThemeContext, applyTheme, readStoredTheme, storeTheme, subscribeSystemTheme } from "@/lib/theme";

/** ธีมสว่าง/มืด/ตามระบบ (ค่าเริ่มต้น "ตามระบบ") — จำไว้ใน localStorage `ong.theme` · ใส่ .dark ที่ <html> */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return undefined;
    return subscribeSystemTheme(() => applyTheme("system"));
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme: (next: Theme) => {
        storeTheme(next);
        setThemeState(next);
      },
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

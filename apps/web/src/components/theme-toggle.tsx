import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { THEMES, isTheme, useTheme } from "@/lib/theme";

/** ปุ่มเปลี่ยนธีมในหัวหน้า — สว่าง · มืด · ตามระบบ (radio ในเมนู · คีย์บอร์ดได้) */
export function ThemeToggle() {
  const { t } = useTranslation("shell");
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label={t("theme.label")}>
          <Sun className="dark:hidden" aria-hidden="true" />
          <Moon className="hidden dark:block" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (isTheme(value)) setTheme(value);
          }}
        >
          {THEMES.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {t(`theme.${option}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

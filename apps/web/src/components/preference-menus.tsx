import { Check, Languages, type LucideIcon, Monitor, Moon, Sun, SunMoon } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLanguage } from "@/hooks/use-language";
import { LANGUAGES, LANGUAGE_NAMES, isLanguage, setLanguage } from "@/i18n";
import { notifyError } from "@/lib/notify";
import { THEMES, type Theme, isTheme, useTheme } from "@/lib/theme";

/**
 * ตัวเลือกธีม (สว่าง/มืด/ตามระบบ) และภาษา (ไทย/English) — ชุดเดียวใช้ทั้งเมนูผู้ใช้ท้าย sidebar (submenu)
 * และมุมขวาบนของหน้า login (ปุ่มไอคอน) · radio item ของ Radix: ไอคอนนำหน้า · เช็กชิดขวา
 */

const THEME_ICONS: Record<Theme, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };

function PreferenceItem({
  value,
  icon: Icon,
  children,
  lang,
}: {
  value: string;
  icon?: LucideIcon;
  children: ReactNode;
  lang?: string;
}) {
  return (
    <DropdownMenuPrimitive.RadioItem
      value={value}
      lang={lang}
      className="relative flex min-w-40 cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
    >
      {Icon && <Icon className="text-muted-foreground" aria-hidden="true" />}
      <span className="flex-1">{children}</span>
      <DropdownMenuPrimitive.ItemIndicator className="ml-auto flex items-center">
        <Check aria-hidden="true" />
      </DropdownMenuPrimitive.ItemIndicator>
    </DropdownMenuPrimitive.RadioItem>
  );
}

/** รายการธีม (ใส่ใน DropdownMenuContent / SubContent) — เก็บใน localStorage `ong.theme` ผ่าน ThemeProvider */
export function ThemeRadioItems() {
  const { t } = useTranslation("shell");
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenuRadioGroup
      value={theme}
      onValueChange={(value) => {
        if (isTheme(value)) setTheme(value);
      }}
    >
      {THEMES.map((option) => (
        <PreferenceItem key={option} value={option} icon={THEME_ICONS[option]}>
          {t(`theme.${option}`)}
        </PreferenceItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

/** รายการภาษา — ชื่อภาษาเป็นภาษานั้นเอง (ไทย · English) · เก็บใน localStorage `ong.lang` */
export function LanguageRadioItems() {
  const { t } = useTranslation("shell");
  const language = useLanguage();
  return (
    <DropdownMenuRadioGroup
      value={language}
      onValueChange={(value) => {
        // โหลดภาษาไม่ได้ (chunk หาย/ค้าง) — ภาษาเดิมยังอยู่ · แจ้งให้ลองใหม่
        if (isLanguage(value)) setLanguage(value).catch(() => notifyError(t("language.loadFailed")));
      }}
    >
      {LANGUAGES.map((option) => (
        <PreferenceItem key={option} value={option} lang={option}>
          {LANGUAGE_NAMES[option]}
        </PreferenceItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

/** ปุ่มไอคอน + เมนู สำหรับหน้าที่ไม่มี sidebar (login) */
function IconMenu({ label, icon: Icon, children }: { label: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} title={label}>
          <Icon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** ปุ่มเลือกธีม (SunMoon) — ชื่อปุ่มบอกธีมปัจจุบัน เช่น "ธีม: มืด" */
export function ThemeMenu() {
  const { t } = useTranslation("shell");
  const { theme } = useTheme();
  return (
    <IconMenu label={t("theme.current", { theme: t(`theme.${theme}`) })} icon={SunMoon}>
      <ThemeRadioItems />
    </IconMenu>
  );
}

/** ปุ่มเลือกภาษา (Languages) — ชื่อปุ่มสองภาษา ให้คนที่อ่านภาษาปัจจุบันไม่ออกยังหาเจอ */
export function LanguageMenu() {
  const { t } = useTranslation("shell");
  return (
    <IconMenu label={t("language.label")} icon={Languages}>
      <LanguageRadioItems />
    </IconMenu>
  );
}

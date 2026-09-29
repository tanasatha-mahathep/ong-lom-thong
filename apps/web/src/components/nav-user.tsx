import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Check, ChevronsUpDown, LogOut, type LucideIcon, Monitor, Moon, Sun, SunMoon } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RailTooltip } from "@/components/rail-tooltip";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { errorMessage } from "@/lib/api";
import type { Me } from "@/lib/queries";
import { signOut } from "@/lib/session";
import { THEMES, type Theme, isTheme, useTheme } from "@/lib/theme";

const THEME_ICONS: Record<Theme, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };

/** สระหน้า (เ แ โ ใ ไ) ไม่ใช่ตัวแรกของชื่อที่อ่านออก — "เจน" ควรเป็น "จ" */
const LEADING_VOWELS = /^[เ-ไ]/u;

/** ตัวอักษรแรกของชื่อสำหรับรูปแทนตัว (ไม่มีรูปผู้ใช้ในระบบ) */
function initialOf(name: string): string {
  const trimmed = name.trim().replace(LEADING_VOWELS, "");
  const first = [...new Intl.Segmenter("th", { granularity: "grapheme" }).segment(trimmed)][0]?.segment ?? "";
  return first.toLocaleUpperCase("th");
}

/** รูปแทนตัวแบบ Avatar ของ sidebar-07 — ประดับ (ชื่ออยู่ในข้อความข้าง ๆ เสมอ) */
function UserAvatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background text-sm font-semibold text-foreground"
    >
      {initialOf(name)}
    </span>
  );
}

function UserText({ me }: { me: Me }) {
  return (
    <span className="grid flex-1 text-left text-sm leading-tight">
      <span className="truncate font-medium">{me.user.name}</span>
      <span className="truncate text-xs text-muted-foreground">{me.user.email}</span>
    </span>
  );
}

/**
 * เมนูผู้ใช้ท้าย sidebar (NavUser ของ sidebar-07) — หัวเมนู = ผู้ใช้ + role · ธีม (สว่าง/มืด/ตามระบบ) · ออกจากระบบ
 * สลับสาขาอยู่ที่หัว sidebar (branch-switcher.tsx)
 */
export function NavUser({ me }: { me: Me }) {
  const { t } = useTranslation("shell");
  const { isMobile } = useSidebar();
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();
  const router = useRouter();

  const signOutMutation = useMutation({
    mutationFn: signOut,
    onSuccess: async () => {
      await router.navigate({ to: "/login" });
      // ล้างหลังออกจากหน้าในแอปแล้ว — ข้อมูลลูกค้า/บิลไม่ค้างในเครื่องที่ใช้ร่วมกัน
      queryClient.clear();
    },
    onError: (error) => toast.error(t("userMenu.signOutFailed", { reason: errorMessage(error) })),
  });

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <RailTooltip label={me.user.name}>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <UserAvatar name={me.user.name} />
                <UserText me={me} />
                <ChevronsUpDown className="ml-auto size-4" aria-hidden="true" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
          </RailTooltip>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <span className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <UserAvatar name={me.user.name} />
                <span className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{me.user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{me.user.email}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {t(`roles.${me.role}`, { ns: "common" })}
                  </span>
                </span>
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <SunMoon aria-hidden="true" />
                {t("theme.label")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={theme}
                  onValueChange={(value) => {
                    if (isTheme(value)) setTheme(value);
                  }}
                >
                  {THEMES.map((option) => {
                    const Icon = THEME_ICONS[option];
                    return (
                      // radio item ของ Radix ตรง ๆ — ไอคอนธีมนำหน้า · เช็กชิดขวาแทนจุดของ ui/dropdown-menu
                      <DropdownMenuPrimitive.RadioItem
                        key={option}
                        value={option}
                        className="relative flex min-w-40 cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
                      >
                        <Icon className="text-muted-foreground" aria-hidden="true" />
                        <span className="flex-1">{t(`theme.${option}`)}</span>
                        <DropdownMenuPrimitive.ItemIndicator className="ml-auto flex items-center">
                          <Check aria-hidden="true" />
                        </DropdownMenuPrimitive.ItemIndicator>
                      </DropdownMenuPrimitive.RadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={signOutMutation.isPending} onSelect={() => signOutMutation.mutate()}>
              <LogOut aria-hidden="true" />
              {t("userMenu.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { EllipsisVertical, LogOut, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { errorMessage } from "@/lib/api";
import type { Me } from "@/lib/queries";
import { signOut } from "@/lib/session";

/** เมนูผู้ใช้ท้าย sidebar — ออกจากระบบ (สลับสาขาอยู่ที่หัว sidebar: branch-switcher.tsx) */
export function NavUser({ me }: { me: Me }) {
  const { t } = useTranslation("shell");
  const { isMobile } = useSidebar();
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
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent">
                <UserRound className="size-4" aria-hidden="true" />
              </span>
              <span className="grid flex-1 text-left text-sm leading-snug">
                <span className="truncate font-medium">{me.user.name}</span>
                <span className="truncate text-xs text-muted-foreground">{me.user.email}</span>
              </span>
              <EllipsisVertical className="ml-auto size-4" aria-hidden="true" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="grid gap-0.5 font-normal leading-snug">
              <span className="truncate font-medium">{me.user.name}</span>
              <span className="truncate text-xs text-muted-foreground">{me.user.email}</span>
              <span className="text-xs text-muted-foreground">{t(`roles.${me.role}`, { ns: "common" })}</span>
            </DropdownMenuLabel>
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

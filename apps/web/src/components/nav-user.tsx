import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { ArrowLeftRight, EllipsisVertical, LogOut, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { errorMessage } from "@/lib/api";
import { type Me, canSwitchBranch, meQueryOptions } from "@/lib/queries";
import { signOut, switchBranch } from "@/lib/session";

/** เมนูผู้ใช้ท้าย sidebar — สลับสาขา (มีสิทธิ์มากกว่า 1 สาขา) · ออกจากระบบ */
export function NavUser({ me }: { me: Me }) {
  const { t } = useTranslation("shell");
  const { isMobile } = useSidebar();
  const queryClient = useQueryClient();
  const router = useRouter();

  const switchMutation = useMutation({
    mutationFn: switchBranch,
    onSuccess: async (branch) => {
      // ข้อมูลทุกหน้าผูกกับสาขา — reset (ไม่ใช่ invalidate) ให้ข้อมูลของสาขาเดิมหายทันที
      // ไม่ค้างโชว์ใต้หัวสาขาใหม่ระหว่างโหลด · me อัปเดตเองก่อน แล้วค่อยถามเซิร์ฟเวอร์ยืนยัน
      queryClient.setQueryData(meQueryOptions.queryKey, (old) => (old ? { ...old, branch } : old));
      await queryClient.resetQueries({ predicate: (query) => query.queryKey[0] !== meQueryOptions.queryKey[0] });
      void queryClient.invalidateQueries({ queryKey: meQueryOptions.queryKey });
      toast.success(t("userMenu.switched", { name: branch.name }));
    },
    onError: (error) => toast.error(t("userMenu.switchFailed", { reason: errorMessage(error) })),
  });

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
            {canSwitchBranch(me) && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={switchMutation.isPending}>
                  <ArrowLeftRight aria-hidden="true" />
                  {t("userMenu.switchBranch")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={me.branch?.id ?? ""}
                    onValueChange={(branchId) => {
                      if (branchId !== me.branch?.id) switchMutation.mutate(branchId);
                    }}
                  >
                    {me.branches.map((branch) => (
                      <DropdownMenuRadioItem key={branch.id} value={branch.id}>
                        <span className="grid leading-snug">
                          <span>{branch.name}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {t("branchCode", { ns: "common", code: branch.code })}
                          </span>
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
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

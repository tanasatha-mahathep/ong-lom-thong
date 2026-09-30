"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { cn } from "cn";
import { SearchIcon } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/*
 * shadcn `command` (cmdk) ปรับให้เข้ากับแอป:
 * - ไม่มีข้อความภาษาอังกฤษเริ่มต้น — title/description ของ CommandDialog และ label ของ CommandList ต้องส่งมา (i18n)
 * - หัวข้อ/คำอธิบาย (sr-only) อยู่ใน DialogContent — ของเดิมอยู่นอก content จึงค้างในหน้าแม้ปิด dialog แล้ว
 * - แถวที่เลือกอยู่มีแถบซ้ายสี foreground (≥ 3:1 ทั้งสองธีม — WCAG 1.4.11) เพิ่มจากพื้น accent ที่ต่างจากพื้นแทบไม่เห็น
 * - ช่องค้น text-base บนจอเล็ก (iOS ไม่ซูมหน้าตอนโฟกัส) เหมือน Input ของแอป
 * - ขนาด/สีไอคอนของแถวบังคับเฉพาะไอคอนนำหน้า (ลูกตรง) — ป้ายในแถว (Badge) คงไอคอนขนาด/สีของตัวเอง
 * - aria-activedescendant ตามแถวที่เลือกจริงเสมอ (useActiveDescendantSync) · CommandDialog ให้ลูกถือ <Command> เองได้ (withCommand)
 */

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** <Command> ของ CommandDialog — ช่องค้นและแถวสูงขึ้นสำหรับหน้าค้นหาเต็มจอ */
function CommandDialogCommand({ className, ...props }: React.ComponentProps<typeof Command>) {
  return (
    <Command
      className={cn(
        "**:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3",
        className,
      )}
      {...props}
    />
  );
}

function CommandDialog({
  title,
  description,
  children,
  className,
  showCloseButton = true,
  commandProps,
  withCommand = true,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title: React.ReactNode;
  description: React.ReactNode;
  className?: string;
  showCloseButton?: boolean;
  /** props ของ <Command> (cmdk) ที่ครอบ children เช่น label ของช่องค้น · shouldFilter · loop */
  commandProps?: Omit<React.ComponentProps<typeof Command>, "children">;
  /** false = children มี <CommandDialogCommand> ของตัวเอง (component ลูกต้องคุม state ของ cmdk เอง เช่น value) */
  withCommand?: boolean;
  /** เปิดด้วยปุ่มลัด (ไม่มี DialogTrigger) Radix ไม่รู้ว่าจะคืนโฟกัสไปไหน — ผู้ใช้จัดการเอง */
  onOpenAutoFocus?: React.ComponentProps<typeof DialogContent>["onOpenAutoFocus"];
  onCloseAutoFocus?: React.ComponentProps<typeof DialogContent>["onCloseAutoFocus"];
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        className={cn("overflow-hidden p-0", className)}
        showCloseButton={showCloseButton}
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {withCommand ? <CommandDialogCommand {...commandProps}>{children}</CommandDialogCommand> : children}
      </DialogContent>
    </Dialog>
  );
}

/**
 * aria-activedescendant ของช่องค้น (และ listbox) ตามแถวที่ aria-selected="true" จริงใน DOM — cmdk 1.1.1 อัปเดตค่านี้เฉพาะตอน
 * กดลูกศร: แถวที่ cmdk เลือกเอง (ตอนเปิด · พิมพ์ · ผลเปลี่ยน) ได้ค่าว่างหรือชี้แถวเก่า screen reader จึงไม่อ่านแถวที่เลือกอยู่
 * (APG combobox · WCAG 4.1.2) — ค่าที่เขียนเองไม่ชน React: cmdk เขียนทับเฉพาะตอนค่าของมันเปลี่ยน แล้วตัวนี้ตามแก้อีกที
 */
function useActiveDescendantSync(input: React.RefObject<HTMLInputElement | null>) {
  React.useEffect(() => {
    const field = input.current;
    const root = field?.closest("[cmdk-root]");
    if (!field || !root) return;
    const sync = () => {
      const active = root.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]')?.id;
      for (const element of [field, root.querySelector("[cmdk-list]")]) {
        if (!element) continue;
        if (active) {
          if (element.getAttribute("aria-activedescendant") !== active) {
            element.setAttribute("aria-activedescendant", active);
          }
        } else if (element.hasAttribute("aria-activedescendant")) {
          element.removeAttribute("aria-activedescendant");
        }
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-selected", "aria-activedescendant"],
    });
    return () => observer.disconnect();
  }, [input]);
}

function CommandInput({ className, ...props }: Omit<React.ComponentProps<typeof CommandPrimitive.Input>, "ref">) {
  const input = React.useRef<HTMLInputElement>(null);
  useActiveDescendantSync(input);
  return (
    <div data-slot="command-input-wrapper" className="flex h-9 items-center gap-2 border-b px-3">
      <SearchIcon className="size-4 shrink-0 opacity-50" aria-hidden="true" />
      <CommandPrimitive.Input
        ref={input}
        data-slot="command-input"
        className={cn(
          // เจ้าของร้านขอเอาเส้นโฟกัสของช่องค้นออก (30 ก.ย.) — dialog โฟกัสช่องนี้ให้เองตอนเปิดอยู่แล้ว จึงไม่ต้องมีเส้น
          // ล้อมซ้ำ · คง outline-hidden (ไม่ใช่ outline-none) ไว้แม้ตอนโฟกัส เพื่อให้ยังเห็นเส้นในโหมด forced-colors
          "flex h-10 w-full rounded-md bg-transparent px-2 py-3 text-base outline-hidden placeholder:text-muted-foreground focus-visible:outline-hidden! disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        {...props}
      />
    </div>
  );
}

/** `label` = ชื่อของ listbox สำหรับ screen reader (cmdk ใส่ "Suggestions" ถ้าไม่ส่ง) */
function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List> & { label: string }) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn("max-h-[300px] scroll-py-1 overflow-x-hidden overflow-y-auto", className)}
      {...props}
    />
  );
}

function CommandEmpty({ ...props }: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty data-slot="command-empty" className="py-6 text-center text-sm" {...props} />;
}

function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[selected=true]:shadow-[inset_3px_0_0_var(--foreground)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&>svg:not([class*='size-'])]:size-4 [&>svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn("ml-auto text-xs tracking-widest text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandDialogCommand,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};

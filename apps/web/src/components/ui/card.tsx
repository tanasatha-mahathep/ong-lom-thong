import * as React from "react";
import { cn } from "cn";

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn("flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm", className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        // เส้นคั่นใต้หัวการ์ดทุกใบ (เจ้าของขอ 3 ต.ค. 2569) — border อยู่บนกล่องที่กว้างเต็มการ์ด จึงชนขอบซ้าย-ขวา
        // (px-6 เป็น padding ไม่ใช่ margin) · pb-4 แทน [.border-b]:pb-6 เดิมของ shadcn ที่ตั้งไว้ตอนใส่เส้นเอง
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 border-b px-6 pb-4 has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  // text-lg (เจ้าของขอ 3 ต.ค. 2569 — ของเดิม text-base/ไม่ตั้งค่าเลยเล็กไปเทียบกับ h1 ของหน้า text-2xl)
  return <div data-slot="card-title" className={cn("text-lg leading-none font-semibold", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-description" className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("px-6", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-footer" className={cn("flex items-center px-6 [.border-t]:pt-6", className)} {...props} />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };

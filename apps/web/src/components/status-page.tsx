import { type ErrorComponentProps, Link, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";

function StatusPage({ title, description, action }: { title: string; description: string; action: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="max-w-md text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}

/** URL ที่ไม่มีหน้า */
export function NotFoundPage() {
  return (
    <StatusPage
      title="ไม่พบหน้านี้"
      description="ลิงก์อาจพิมพ์ผิด หรือหน้านี้ถูกย้ายไปแล้ว"
      action={
        <Button asChild>
          <Link to="/">กลับหน้าแรก</Link>
        </Button>
      }
    />
  );
}

/** error ที่หลุดจาก loader/component — ลองโหลดใหม่ได้ */
export function ErrorPage({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <StatusPage
      title="เกิดข้อผิดพลาด"
      description={errorMessage(error)}
      action={
        <Button
          onClick={() => {
            reset();
            void router.invalidate();
          }}
        >
          ลองใหม่
        </Button>
      }
    />
  );
}

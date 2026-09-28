import { type ErrorComponentProps, Link, useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { isChunkLoadError, page, reloadOnceForUpdate } from "@/lib/app-update";

function StatusPage({ title, description, action }: { title: string; description?: string; action: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-bold">{title}</h1>
      {description && <p className="max-w-md text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}

/** URL ที่ไม่มีหน้า */
export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <StatusPage
      title={t("status.notFoundTitle")}
      description={t("status.notFoundBody")}
      action={
        <Button asChild>
          <Link to="/">{t("status.backHome")}</Link>
        </Button>
      }
    />
  );
}

/** error ที่หลุดจาก loader/component — chunk ของ build เก่าหาย = มีเวอร์ชันใหม่ · อื่น ๆ ลองโหลดใหม่ได้ */
export function ErrorPage(props: ErrorComponentProps) {
  return isChunkLoadError(props.error) ? <UpdateAvailablePage /> : <RouteErrorPage {...props} />;
}

function RouteErrorPage({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <StatusPage
      title={t("status.errorTitle")}
      description={errorMessage(error)}
      action={
        <Button
          onClick={() => {
            reset();
            void router.invalidate();
          }}
        >
          {t("retry")}
        </Button>
      }
    />
  );
}

/** เปลี่ยนหน้าแล้วโหลด chunk ไม่ได้ — reload ให้เองครั้งเดียว (กันวน) ไม่งั้นรอผู้ใช้กด */
function UpdateAvailablePage() {
  const { t } = useTranslation("shell");
  useEffect(() => {
    reloadOnceForUpdate();
  }, []);
  return (
    <StatusPage
      title={t("update.message")}
      action={<Button onClick={() => page.reload()}>{t("update.reload")}</Button>}
    />
  );
}

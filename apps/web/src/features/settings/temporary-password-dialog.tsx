import { Copy, TriangleAlert } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useTranslation } from "./i18n";

/** รหัสผ่านชั่วคราวที่ API ตอบมาครั้งเดียว — อยู่ใน state ของหน้าเท่านั้น ปิด dialog = ทิ้ง */
export interface TemporarySecret {
  name: string;
  email: string;
  password: string;
  /** ตั้งรหัสผ่านใหม่: จำนวนเครื่องที่ถูกออกจากระบบ */
  sessionsRevoked?: number;
}

/**
 * แสดงรหัสผ่านชั่วคราวครั้งเดียว — ปิดแล้ว (ปุ่ม/Esc) เนื้อหาถูกถอดออกทันที และหน้าต้องล้าง state (onClose)
 * AlertDialog: คลิกนอกกรอบไม่ปิด (กันหายก่อนคัดลอก)
 */
export function TemporaryPasswordDialog({
  secret,
  onClose,
  onCloseAutoFocus,
}: {
  secret: TemporarySecret | null;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  return (
    <AlertDialog
      open={secret !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {secret && <SecretContent secret={secret} onCloseAutoFocus={onCloseAutoFocus} />}
    </AlertDialog>
  );
}

function SecretContent({
  secret,
  onCloseAutoFocus,
}: {
  secret: TemporarySecret;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { t } = useTranslation("settings");
  const ids = useId();
  const fieldId = `${ids}-password`;
  const warningId = `${ids}-warning`;
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const copyButton = useRef<HTMLButtonElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(secret.password);
      setCopy("copied");
      toast.success(t("temporaryPassword.copied"));
    } catch {
      // ไม่มี Clipboard API (http ที่ไม่ใช่ localhost) หรือ browser ไม่ให้ — เลือกข้อความให้กด Ctrl+C เอง
      setCopy("failed");
      passwordField.current?.focus();
      passwordField.current?.select();
    }
  };

  return (
    <AlertDialogContent
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        copyButton.current?.focus();
      }}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <AlertDialogHeader>
        <AlertDialogTitle>{t("temporaryPassword.title", { name: secret.name })}</AlertDialogTitle>
        <AlertDialogDescription>{t("temporaryPassword.description", { email: secret.email })}</AlertDialogDescription>
      </AlertDialogHeader>

      <div
        id={warningId}
        className="grid gap-1 rounded-md border border-warning-border bg-warning p-3 text-sm text-warning-foreground"
      >
        <p className="flex items-center gap-2 font-semibold">
          <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          {t("temporaryPassword.warning")}
        </p>
        <p>{t("temporaryPassword.warningDetail")}</p>
      </div>

      <Field>
        <FieldLabel htmlFor={fieldId}>{t("temporaryPassword.label")}</FieldLabel>
        <Input
          ref={passwordField}
          id={fieldId}
          readOnly
          value={secret.password}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={warningId}
          className="h-11 font-mono text-lg tracking-wider md:text-lg"
          onFocus={(event) => event.currentTarget.select()}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button ref={copyButton} type="button" variant="outline" onClick={() => void copyPassword()}>
          <Copy aria-hidden="true" />
          {t("temporaryPassword.copy")}
        </Button>
        {/* toast อยู่นอก dialog (โปรแกรมอ่านจอถูกซ่อนไว้ระหว่างเปิด modal) — ประกาศซ้ำในกรอบนี้ */}
        <p role="status" aria-live="polite" className="text-sm">
          {copy === "copied"
            ? t("temporaryPassword.copied")
            : copy === "failed"
              ? t("temporaryPassword.copyFailed")
              : null}
        </p>
      </div>

      {secret.sessionsRevoked !== undefined && secret.sessionsRevoked > 0 && (
        <p className="text-sm text-muted-foreground">
          {t("temporaryPassword.sessionsRevoked", { count: secret.sessionsRevoked })}
        </p>
      )}

      <AlertDialogFooter>
        <AlertDialogAction>{t("temporaryPassword.close")}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

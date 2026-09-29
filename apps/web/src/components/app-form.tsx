import { LoaderCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { AppFormControls } from "@/hooks/use-app-form";
import { cn } from "@/lib/utils";

/**
 * `<form>` ของ `useAppForm` (U4) — ระหว่างส่งทั้งฟอร์มถูกปิดด้วย `<fieldset disabled>` (ช่อง · ปุ่ม · ลิงก์ปุ่ม)
 * `aria-busy` บอก screen reader ว่ากำลังทำงาน · Ctrl+Enter = บันทึก · ไม่ใช้ validation ของ browser (noValidate)
 */
export function AppForm({
  form,
  fieldsetClassName,
  className,
  children,
  ...props
}: Omit<ComponentProps<"form">, "onSubmit" | "ref" | "noValidate"> & {
  form: AppFormControls;
  /** class ของ `<fieldset>` ที่ครอบเนื้อหา (ค่าเริ่มต้นไม่มีขอบ/ระยะ) */
  fieldsetClassName?: string;
}) {
  return (
    <form {...props} {...form.formProps} aria-busy={form.submitting || undefined} className={className}>
      <fieldset disabled={form.submitting} className={cn("m-0 min-w-0 border-0 p-0", fieldsetClassName)}>
        {children}
      </fieldset>
    </form>
  );
}

/** ปุ่มบันทึกของ `useAppForm` — ระหว่างส่ง: หมุน + "กำลังบันทึก…" (หรือ `pendingLabel`) และกดไม่ได้ */
export function SubmitButton({
  form,
  pendingLabel,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "type" | "ref" | "form"> & {
  form: AppFormControls;
  /** ข้อความระหว่างส่ง — ค่าเริ่มต้น common.saving "กำลังบันทึก…" */
  pendingLabel?: ReactNode;
}) {
  const { t } = useTranslation("common");
  const { submitting, submitButton } = form;
  return (
    <Button {...props} ref={submitButton} type="submit" aria-keyshortcuts="Control+Enter">
      {submitting && <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />}
      {submitting ? (pendingLabel ?? t("saving")) : children}
    </Button>
  );
}

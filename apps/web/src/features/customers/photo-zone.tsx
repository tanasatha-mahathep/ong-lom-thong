import { ClipboardPaste, ImagePlus, X } from "lucide-react";
import { type ClipboardEvent, type DragEvent, type KeyboardEvent, useEffect, useEffectEvent, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldTitle } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { BlobImage } from "./blob-image";
import { type CustomersKey, useTranslation } from "./i18n";
import { canReadClipboard, imageFromDataTransfer, readClipboardImage } from "./photo";

interface PhotoZoneProps {
  /** id ของกรอบ (ลำดับที่ 9 ของ Siam ID) */
  id: string;
  label: string;
  /** รูปใหม่ที่จะบันทึก */
  value: File | null;
  /** รูปที่บันทึกไว้แล้ว (หน้าแก้ไข) */
  existing?: Blob;
  existingPending?: boolean;
  /** ข้อความ error ที่แปลแล้ว */
  errors: string[];
  /** ได้ไฟล์มา (ยังไม่ได้ตรวจ — ฟอร์มตรวจชนิด/ขนาดเอง) */
  onFile: (file: File) => void;
  onRemove: () => void;
  onProblem: (problem: CustomersKey) => void;
}

const hasFiles = (data: DataTransfer | null) => data?.types.includes("Files") ?? false;

/**
 * ช่องที่ 9 "รูปภาพ" — กรอบที่รับโฟกัสได้ (Tab จากช่องที่ 8 มาหยุดที่นี่) แล้วกด Ctrl+V วางรูปจาก Siam ID
 * - ทางสำรอง: ลากไฟล์มาวาง · ปุ่มเลือกไฟล์ · ปุ่มอ่านคลิปบอร์ด (ปุ่มทั้งหมด tabIndex −1 ไม่แทรกลำดับ Tab)
 * - วางรูปขณะโฟกัสอยู่ช่องอื่น (Siam ID Tab เกิน) ก็รับ — ถ้าคลิปบอร์ดมีข้อความด้วย ปล่อยให้วางข้อความตามปกติ
 * - ไม่มีปุ่มไหนเปิดหน้าต่างเลือกไฟล์จากคีย์บอร์ด: Enter/Space กลางลำดับ Siam ID ต้องไม่เปิด dialog
 * - Delete/Backspace ที่กรอบ = เอารูปใหม่ออก (ทางคีย์บอร์ดแทนปุ่ม "ยกเลิกรูปใหม่")
 * - ขอบประใช้ muted-foreground (≥ 3:1 กับพื้นทั้งสองโหมด · WCAG 1.4.11) · โฟกัสเป็นเส้น ring ทึบ
 */
export function PhotoZone({
  id,
  label,
  value,
  existing,
  existingPending = false,
  errors,
  onFile,
  onRemove,
  onProblem,
}: PhotoZoneProps) {
  const { t } = useTranslation("customers");
  const fileInput = useRef<HTMLInputElement>(null);
  const invalid = errors.length > 0;
  const titleId = `${id}-label`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const take = (data: DataTransfer | null) => {
    const file = imageFromDataTransfer(data);
    if (file) onFile(file);
    return file !== null;
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!take(event.clipboardData)) onProblem("photo.clipboardEmpty");
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    take(event.dataTransfer);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === "Delete" || event.key === "Backspace") && value) {
      event.preventDefault();
      onRemove();
    } else if (event.key === " ") {
      // Space บน div เลื่อนหน้าจอ — เช่น Siam ID พิมพ์เกินมาถึงกรอบนี้
      event.preventDefault();
    }
  };

  // วางรูปที่ไหนก็ได้ในหน้า (โฟกัสหลุดไปช่องอื่น) · ลากไฟล์ไปวางนอกกรอบ = รับเป็นรูป ไม่ให้ browser เปิดไฟล์ทับฟอร์ม
  const onDocumentPaste = useEffectEvent((event: globalThis.ClipboardEvent) => {
    if (event.defaultPrevented) return;
    const file = imageFromDataTransfer(event.clipboardData);
    if (!file?.type.startsWith("image/")) return;
    const target = event.target;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    if (typing && event.clipboardData?.getData("text/plain")) return;
    event.preventDefault();
    onFile(file);
  });
  const onDocumentDrop = useEffectEvent((event: globalThis.DragEvent) => {
    if (event.defaultPrevented || !hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    take(event.dataTransfer);
  });
  useEffect(() => {
    const paste = (event: globalThis.ClipboardEvent) => onDocumentPaste(event);
    const dragOver = (event: globalThis.DragEvent) => {
      if (hasFiles(event.dataTransfer)) event.preventDefault();
    };
    const drop = (event: globalThis.DragEvent) => onDocumentDrop(event);
    document.addEventListener("paste", paste);
    window.addEventListener("dragover", dragOver);
    window.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("paste", paste);
      window.removeEventListener("dragover", dragOver);
      window.removeEventListener("drop", drop);
    };
  }, []);

  const pasteFromClipboard = async () => {
    try {
      const file = await readClipboardImage();
      if (file) onFile(file);
      else onProblem("photo.clipboardEmpty");
    } catch {
      onProblem("photo.clipboardDenied");
    }
  };

  return (
    <Field data-invalid={invalid || undefined}>
      <FieldTitle id={titleId}>{label}</FieldTitle>
      <div
        id={id}
        role="group"
        tabIndex={0}
        aria-labelledby={titleId}
        aria-describedby={invalid ? `${hintId} ${errorId}` : hintId}
        aria-invalid={invalid || undefined}
        data-testid="photo-zone"
        onPaste={onPaste}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        onKeyDown={onKeyDown}
        className={cn(
          "group flex min-h-40 w-full max-w-md flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground bg-background p-3 text-center",
          "focus:border-solid focus:border-ring focus:ring-[3px] focus:ring-ring/50",
          invalid && "border-destructive",
        )}
      >
        {value ? (
          <figure className="flex flex-col items-center gap-1">
            <BlobImage blob={value} alt={t("photo.newAlt")} className="max-h-56 max-w-full rounded object-contain" />
            <figcaption className="text-sm font-medium">{t("photo.newCaption")}</figcaption>
          </figure>
        ) : existing ? (
          <figure className="flex flex-col items-center gap-1">
            <BlobImage
              blob={existing}
              alt={t("photo.current")}
              className="max-h-56 max-w-full rounded object-contain"
            />
            <figcaption className="text-sm text-muted-foreground">{t("photo.current")}</figcaption>
          </figure>
        ) : existingPending ? (
          <Skeleton className="h-40 w-32" />
        ) : (
          <p className="text-muted-foreground">{t("photo.empty")}</p>
        )}
        <p className="hidden text-sm font-medium text-foreground group-focus:block">
          {t(value ? "photo.focusHintRemove" : "photo.focusHint")}
        </p>
      </div>
      <FieldDescription id={hintId}>{t("photo.hint")}</FieldDescription>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" tabIndex={-1} onClick={() => fileInput.current?.click()}>
          <ImagePlus aria-hidden="true" />
          {t("photo.chooseFile")}
        </Button>
        {canReadClipboard() && (
          <Button type="button" variant="outline" size="sm" tabIndex={-1} onClick={() => void pasteFromClipboard()}>
            <ClipboardPaste aria-hidden="true" />
            {t("photo.pasteClipboard")}
          </Button>
        )}
        {value && (
          <Button type="button" variant="ghost" size="sm" tabIndex={-1} onClick={onRemove}>
            <X aria-hidden="true" />
            {t("photo.removeNew")}
          </Button>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        tabIndex={-1}
        data-testid="photo-file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onFile(file);
        }}
      />
      {invalid && <FieldError id={errorId}>{errors.join(" · ")}</FieldError>}
      <p className="sr-only" aria-live="polite">
        {value ? t("photo.pasted") : ""}
      </p>
    </Field>
  );
}

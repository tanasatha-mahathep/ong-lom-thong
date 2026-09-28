import { type ComponentProps, useCallback } from "react";

/**
 * แสดงรูปจาก Blob/File (รูปลูกค้าที่ดึงผ่าน api · รูปที่เพิ่งวาง) — ไม่มี URL ถาวรของรูปใน DOM
 * object URL สร้างและคืนใน ref callback (React 19 cleanup) จึงไม่รั่วและไม่พังใน StrictMode
 */
export function BlobImage({ blob, alt, ...img }: { blob: Blob; alt: string } & Omit<ComponentProps<"img">, "src">) {
  const ref = useCallback(
    (element: HTMLImageElement | null) => {
      if (!element) return;
      const url = URL.createObjectURL(blob);
      element.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [blob],
  );
  return <img ref={ref} alt={alt} {...img} />;
}

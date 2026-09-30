import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useLanguage } from "@/hooks/use-language";
import type { LegalContent, LegalDocument } from "./content/types";
import { LEGAL_IS_DRAFT, type LegalLanguage, fillLegal, isPlaceholder } from "./legal-config";

export type LegalDocKey = keyof LegalContent;

/** เนื้อหาเอกสาร (ไทย/อังกฤษ) โหลดแยกเมื่อเปิดกล่องครั้งแรก — ไม่อยู่ใน bundle หลักของหน้า login */
async function loadContent(language: LegalLanguage): Promise<LegalContent> {
  const module = language === "en" ? await import("./content/en") : await import("./content/th");
  return module.default;
}

/** เนื้อหาหลังแทนค่าจาก legal-config แล้ว */
function fillDocument(doc: LegalDocument, language: LegalLanguage): LegalDocument {
  return {
    title: fillLegal(doc.title, language),
    subtitle: fillLegal(doc.subtitle, language),
    sections: doc.sections.map((section) => ({
      heading: fillLegal(section.heading, language),
      body: section.body.map((block) =>
        typeof block === "string"
          ? fillLegal(block, language)
          : { list: block.list.map((item) => fillLegal(item, language)) },
      ),
    })),
  };
}

/** ยังมีช่อง "[…]" ที่ต้องกรอก/รอยืนยัน ไม่ว่าจะอยู่ใน config หรือในเนื้อหา */
function documentHasPlaceholder(doc: LegalDocument): boolean {
  const texts = [
    doc.subtitle,
    ...doc.sections.flatMap((s) => s.body.flatMap((b) => (typeof b === "string" ? [b] : b.list))),
  ];
  return texts.some((text) => text.split(/(?=\[)/).some((part) => isPlaceholder(part) && part.includes("]")));
}

/**
 * ลิงก์ในประโยคยอมรับใต้ปุ่มเข้าสู่ระบบ → กล่อง (Dialog) เนื้อหาเลื่อนได้ · หัวเรื่อง + คำอธิบายสั้น + เนื้อหา + ปุ่มปิด (X)
 * Esc ปิด · โฟกัสกลับที่ลิงก์เดิม (Radix) · ใช้ได้ทั้งธีมสว่าง/มืดและจอโทรศัพท์
 * ป้าย "ฉบับร่าง" แสดงเองระหว่างที่ legal-config.ts / เนื้อหายังมีช่องที่ต้องกรอก
 */
export function LegalDialog({ doc, children }: { doc: LegalDocKey; children?: ReactNode }) {
  const { t } = useTranslation("auth");
  const language = useLanguage();
  const content = useQuery({
    queryKey: ["legal", language],
    queryFn: () => loadContent(language),
    staleTime: Number.POSITIVE_INFINITY,
    meta: { handlesUnauthorized: true },
  });
  const legalDoc = content.data ? fillDocument(content.data[doc], language) : null;
  const draft = LEGAL_IS_DRAFT || (legalDoc !== null && documentHasPlaceholder(legalDoc));
  const title = legalDoc?.title ?? t(`legal.${doc}`);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="font-medium text-foreground underline underline-offset-4 hover:text-primary">
          {children}
        </button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85svh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="gap-2 border-b p-6 pr-12 text-left">
          <DialogTitle className="text-xl">{title}</DialogTitle>
          <DialogDescription>{legalDoc?.subtitle ?? t("legal.loading")}</DialogDescription>
          {draft && (
            <p
              role="note"
              className="flex items-start gap-2 rounded-md border border-warning-border bg-warning px-3 py-2 text-sm text-warning-foreground"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t("legal.draft")}
            </p>
          )}
        </DialogHeader>
        {/* พื้นที่เลื่อนรับโฟกัสได้ — เลื่อนด้วยคีย์บอร์ด (ลูกศร/Page Down) */}
        <div
          role="region"
          aria-label={title}
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto p-6 text-sm leading-relaxed"
        >
          {legalDoc ? (
            <div className="flex flex-col gap-5">
              {legalDoc.sections.map((section) => (
                <section key={section.heading} className="flex flex-col gap-2">
                  <h3 className="text-base font-semibold">{section.heading}</h3>
                  {section.body.map((block, i) =>
                    typeof block === "string" ? (
                      <p key={i}>{block}</p>
                    ) : (
                      <ul key={i} className="ml-5 list-disc space-y-1">
                        {block.list.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ),
                  )}
                </section>
              ))}
            </div>
          ) : content.isError ? (
            <p>{t("legal.loadFailed")}</p>
          ) : (
            <div className="flex flex-col gap-3" aria-busy="true">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

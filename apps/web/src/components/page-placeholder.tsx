import { Construction } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/page-header";

/** หน้าที่ยังไม่ได้ทำ — route มีแล้ว (routeTree นิ่ง) รอเอเจนต์ของแต่ละหน้ามาแทน `component` */
export function PagePlaceholder() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader />
      <section className="flex items-center gap-3 rounded-xl border bg-card p-6 text-card-foreground">
        <Construction className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p>{t("placeholder")}</p>
      </section>
    </>
  );
}

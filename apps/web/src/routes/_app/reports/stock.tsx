import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/page-placeholder";

export const Route = createFileRoute("/_app/reports/stock")({
  staticData: { title: "สต็อกคงเหลือ", crumbs: [{ title: "รายงาน" }] },
  component: PagePlaceholder,
});

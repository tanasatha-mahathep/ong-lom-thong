import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/page-placeholder";

export const Route = createFileRoute("/_app/reports/export")({
  staticData: { title: "ส่งบัญชีรายเดือน", crumbs: [{ title: "รายงาน" }] },
  component: PagePlaceholder,
});

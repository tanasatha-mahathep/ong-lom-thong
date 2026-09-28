import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/page-placeholder";

export const Route = createFileRoute("/_app/reports/export")({
  staticData: { title: "export", crumbs: [{ title: "reports" }] },
  component: PagePlaceholder,
});

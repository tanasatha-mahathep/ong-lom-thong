import { createFileRoute } from "@tanstack/react-router";
import { ExportPage } from "@/features/reports/export-page";

export const Route = createFileRoute("/_app/reports/export")({
  staticData: { title: "export", crumbs: [{ title: "reports" }] },
  component: ExportPage,
});

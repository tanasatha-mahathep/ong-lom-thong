import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/page-placeholder";

export const Route = createFileRoute("/_app/bills")({
  staticData: { title: "bills" },
  component: PagePlaceholder,
});

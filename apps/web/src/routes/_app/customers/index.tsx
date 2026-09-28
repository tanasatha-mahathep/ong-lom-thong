import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/page-placeholder";

export const Route = createFileRoute("/_app/customers/")({
  staticData: { title: "customers" },
  component: PagePlaceholder,
});

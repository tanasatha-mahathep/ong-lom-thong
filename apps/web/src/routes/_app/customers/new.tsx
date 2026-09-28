import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/page-placeholder";

export const Route = createFileRoute("/_app/customers/new")({
  staticData: { title: "customerNew", crumbs: [{ title: "customers", to: "/customers" }] },
  component: PagePlaceholder,
});

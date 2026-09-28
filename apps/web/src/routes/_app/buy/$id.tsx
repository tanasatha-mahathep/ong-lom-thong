import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/page-placeholder";

export const Route = createFileRoute("/_app/buy/$id")({
  staticData: { title: "bill", crumbs: [{ title: "bills", to: "/bills" }] },
  component: PagePlaceholder,
});

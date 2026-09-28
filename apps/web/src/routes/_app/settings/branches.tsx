import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/page-placeholder";

export const Route = createFileRoute("/_app/settings/branches")({
  staticData: { title: "branches", crumbs: [{ title: "settings" }] },
  component: PagePlaceholder,
});

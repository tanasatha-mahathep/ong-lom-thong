import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/page-placeholder";

export const Route = createFileRoute("/_app/settings/users")({
  staticData: { title: "users", crumbs: [{ title: "settings" }] },
  component: PagePlaceholder,
});

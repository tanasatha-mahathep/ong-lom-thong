import { createFileRoute } from "@tanstack/react-router";
import { BranchesPage } from "@/features/settings/branches-page";

export const Route = createFileRoute("/_app/settings/branches")({
  staticData: { title: "branches", crumbs: [{ title: "settings" }] },
  component: BranchesPage,
});

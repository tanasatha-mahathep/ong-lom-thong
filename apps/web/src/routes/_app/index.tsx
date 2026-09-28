import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/page-placeholder";

export const Route = createFileRoute("/_app/")({
  staticData: { title: "หน้าแรก" },
  component: PagePlaceholder,
});

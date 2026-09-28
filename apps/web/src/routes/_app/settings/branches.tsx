import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/page-placeholder";

export const Route = createFileRoute("/_app/settings/branches")({
  staticData: { title: "จัดการสาขา", crumbs: [{ title: "ตั้งค่า" }] },
  component: PagePlaceholder,
});

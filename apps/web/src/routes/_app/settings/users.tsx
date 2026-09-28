import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/page-placeholder";

export const Route = createFileRoute("/_app/settings/users")({
  staticData: { title: "จัดการผู้ใช้", crumbs: [{ title: "ตั้งค่า" }] },
  component: PagePlaceholder,
});

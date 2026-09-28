import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/page-placeholder";

export const Route = createFileRoute("/_app/settings/gold-price")({
  staticData: { title: "ตั้งราคาทองวันนี้", crumbs: [{ title: "ตั้งค่า" }] },
  component: PagePlaceholder,
});

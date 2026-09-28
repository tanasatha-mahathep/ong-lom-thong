import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/page-placeholder";

export const Route = createFileRoute("/_app/customers/new")({
  staticData: { title: "เพิ่มลูกค้า", crumbs: [{ title: "ลูกค้า", to: "/customers" }] },
  component: PagePlaceholder,
});

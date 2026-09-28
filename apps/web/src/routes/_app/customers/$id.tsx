import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/page-placeholder";

export const Route = createFileRoute("/_app/customers/$id")({
  staticData: { title: "ข้อมูลลูกค้า", crumbs: [{ title: "ลูกค้า", to: "/customers" }] },
  component: PagePlaceholder,
});

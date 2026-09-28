import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/page-placeholder";

export const Route = createFileRoute("/_app/buy/")({
  staticData: { title: "ซื้อเข้า" },
  component: PagePlaceholder,
});

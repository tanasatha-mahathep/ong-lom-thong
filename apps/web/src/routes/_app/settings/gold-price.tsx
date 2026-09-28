import { createFileRoute } from "@tanstack/react-router";
import { GoldPricePage } from "@/features/gold-price/gold-price-page";

export const Route = createFileRoute("/_app/settings/gold-price")({
  staticData: { title: "ตั้งราคาทองวันนี้", crumbs: [{ title: "ตั้งค่า" }] },
  component: GoldPricePage,
});

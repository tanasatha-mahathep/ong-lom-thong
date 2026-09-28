import { createFileRoute } from "@tanstack/react-router";
import { GoldPricePage } from "@/features/gold-price/gold-price-page";

export const Route = createFileRoute("/_app/settings/gold-price")({
  staticData: { title: "goldPrice", crumbs: [{ title: "settings" }] },
  component: GoldPricePage,
});

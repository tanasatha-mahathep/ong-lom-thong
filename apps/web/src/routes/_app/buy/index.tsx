import { createFileRoute } from "@tanstack/react-router";
import { BuyPage } from "@/features/buy/BuyPage";
import { metalsQuery } from "@/features/buy/queries";

export const Route = createFileRoute("/_app/buy/")({
  staticData: { title: "ซื้อเข้า" },
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(metalsQuery),
  component: BuyPage,
});

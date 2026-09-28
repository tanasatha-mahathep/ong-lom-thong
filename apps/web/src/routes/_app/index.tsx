import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "@/features/home/home-page";

export const Route = createFileRoute("/_app/")({
  staticData: { title: "หน้าแรก" },
  component: HomePage,
});

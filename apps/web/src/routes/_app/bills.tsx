import { createFileRoute } from "@tanstack/react-router";
import { BillsPage } from "@/features/bills/BillsPage";
import { billsSearchSchema } from "@/features/bills/search";

export const Route = createFileRoute("/_app/bills")({
  staticData: { title: "bills" },
  validateSearch: billsSearchSchema,
  component: BillsPage,
});

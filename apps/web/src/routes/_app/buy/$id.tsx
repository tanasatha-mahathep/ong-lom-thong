import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { BillPage } from "@/features/buy/BillPage";
import { billQuery } from "@/features/buy/bill-api";

/** ?print=true มาจากหน้าซื้อเข้าหลังบันทึก (พิมพ์อัตโนมัติ) — ค่าอื่น = ไม่พิมพ์ */
const searchSchema = z.object({ print: z.boolean().optional().catch(undefined) });

export const Route = createFileRoute("/_app/buy/$id")({
  staticData: { title: "bill", crumbs: [{ title: "bills", to: "/bills" }] },
  validateSearch: searchSchema,
  loader: ({ context: { queryClient }, params }) => queryClient.ensureQueryData(billQuery(params.id)),
  component: BillRoute,
});

function BillRoute() {
  const { id } = Route.useParams();
  const { print } = Route.useSearch();
  return <BillPage key={id} id={id} autoPrint={print === true} />;
}

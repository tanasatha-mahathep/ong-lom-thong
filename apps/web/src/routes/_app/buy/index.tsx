import { createFileRoute } from "@tanstack/react-router";
import { BuyPage } from "@/features/buy/BuyPage";
import { metalsQuery } from "@/features/buy/queries";
import { canCreateBill } from "@/lib/nav";
import { meQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/_app/buy/")({
  staticData: { title: "ซื้อเข้า" },
  // โลหะเฉพาะผู้ที่เปิดบิลได้ — ฝ่ายบัญชี/ยังไม่มีสาขาเห็นแค่ข้อความ (API ตอบ 403 ถ้าไม่มีสาขาที่เปิดอยู่)
  loader: async ({ context: { queryClient } }) => {
    const me = await queryClient.ensureQueryData(meQueryOptions);
    if (canCreateBill(me.role) && me.branch) await queryClient.ensureQueryData(metalsQuery);
  },
  component: BuyPage,
});

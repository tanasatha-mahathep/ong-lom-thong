import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { CustomerForm } from "@/features/customers/customer-form";
import { DuplicateLink } from "@/features/customers/duplicate-link";
import { useTranslation } from "@/features/customers/i18n";
import { useCreateCustomer } from "@/features/customers/queries";

/** `from=buy` = /buy เปิดหน้านี้ในแท็บใหม่ (`window.open("/customers/new?from=buy")`) */
const SearchSchema = z.object({ from: z.enum(["buy"]).optional().catch(undefined) });

export const Route = createFileRoute("/_app/customers/new")({
  validateSearch: SearchSchema,
  staticData: { title: "เพิ่มลูกค้า", crumbs: [{ title: "ลูกค้า", to: "/customers" }] },
  component: NewCustomerPage,
});

/** /customers/new — ฟอร์ม Siam ID · บันทึกแล้วไปหน้าลูกค้าเดี่ยว (เห็นสถานะบัตรก่อนกลับไปซื้อเข้า) */
function NewCustomerPage() {
  const { t } = useTranslation("customers");
  const { from } = Route.useSearch();
  const navigate = Route.useNavigate();
  const create = useCreateCustomer();

  return (
    <>
      <PageHeader description={from === "buy" ? t("create.fromBuy") : undefined} />
      <CustomerForm
        mode="create"
        autoFocus
        onSubmit={async (values) => {
          const { id } = await create.mutateAsync(values);
          await navigate({ to: "/customers/$id", params: { id }, search: { saved: "created", from }, replace: true });
        }}
        onCancel={() => void navigate({ to: "/customers" })}
        renderDuplicateLink={(id, focusable) => <DuplicateLink id={id} focusable={focusable} />}
      />
    </>
  );
}

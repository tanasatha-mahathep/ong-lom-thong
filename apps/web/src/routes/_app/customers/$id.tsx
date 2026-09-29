import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CircleAlert, CircleCheck, Pencil, X } from "lucide-react";
import { useCallback, useState } from "react";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CardStatusBadge, CardStatusNotice } from "@/features/customers/card-status";
import { CustomerForm } from "@/features/customers/customer-form";
import { CustomerView } from "@/features/customers/customer-view";
import { DuplicateLink } from "@/features/customers/duplicate-link";
import { useTranslation } from "@/features/customers/i18n";
import { type CustomerDetail, toFormValues } from "@/features/customers/model";
import { customerDetailQuery, customerPhotoQuery, useUpdateCustomer } from "@/features/customers/queries";
import { useCustomerSync } from "@/features/customers/sync";
import { ApiError } from "@/lib/api";

/**
 * mode=edit = ฟอร์มแก้ไข · from=buy = /buy เปิดในแท็บใหม่ (`/customers/:id?mode=edit&from=buy`)
 * saved = เพิ่งบันทึก (แสดงข้อความยืนยันจนกว่าจะปิด)
 */
const SearchSchema = z.object({
  mode: z.enum(["edit"]).optional().catch(undefined),
  from: z.enum(["buy"]).optional().catch(undefined),
  saved: z.enum(["created", "updated"]).optional().catch(undefined),
});

export const Route = createFileRoute("/_app/customers/$id")({
  validateSearch: SearchSchema,
  staticData: { title: "customer", crumbs: [{ title: "customers", to: "/customers" }] },
  component: CustomerPage,
});

/** ย้ายโฟกัสไปที่เนื้อหาใหม่ (เปลี่ยนโหมด/บันทึกเสร็จ) — ปุ่มที่กดหายไป โฟกัสจึงไม่หลุดไปต้นหน้า */
const focusOnMount = (element: HTMLElement | null) => element?.focus();

/** โหมดของหน้าเปลี่ยนหลังเปิดหน้าแล้ว (ดู ↔ แก้ไข) — เปิดหน้ามาครั้งแรกไม่ย้ายโฟกัส */
function useModeChanged(mode: "view" | "edit"): boolean {
  const [shown, setShown] = useState(mode);
  const [changed, setChanged] = useState(false);
  if (mode !== shown) {
    setShown(mode);
    setChanged(true);
  }
  return changed;
}

/** /customers/$id — หน้าเดียวที่แสดงเลขบัตรเต็ม (R13) · ดู/แก้ไข · สถานะบัตร */
function CustomerPage() {
  const { t } = useTranslation("customers");
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const modeChanged = useModeChanged(search.mode ?? "view");
  useCustomerSync();

  const detail = useQuery(customerDetailQuery(id));
  const customer = detail.data;
  const photo = useQuery({
    ...customerPhotoQuery(id, customer?.updated_at ?? ""),
    enabled: customer?.has_photo === true,
  });

  if (detail.isPending) {
    return (
      <>
        <PageHeader back="/customers" />
        <Skeleton className="h-96 w-full max-w-3xl" role="status" aria-label={t("detail.loading")} />
      </>
    );
  }
  if (!customer) {
    const notFound = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <>
        <PageHeader back="/customers" />
        <Alert variant="destructive" className="max-w-3xl">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{t(notFound ? "detail.notFound" : "detail.loadFailed")}</AlertTitle>
          <AlertDescription className="flex flex-wrap gap-3 text-destructive">
            {!notFound && (
              <Button type="button" variant="outline" size="sm" onClick={() => void detail.refetch()}>
                {t("detail.retry")}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      </>
    );
  }

  const photoState = {
    blob: photo.data,
    loading: customer.has_photo && photo.isPending,
    failed: photo.isError,
  };
  const setMode = (mode: "edit" | undefined, saved?: "updated") =>
    void navigate({ search: (prev) => ({ ...prev, mode, saved }), replace: mode === undefined });

  if (search.mode === "edit") {
    return (
      <>
        <PageHeader back="/customers" description={customer.name_th} />
        <div ref={modeChanged ? focusOnMount : undefined} tabIndex={-1}>
          <EditCustomer
            customer={customer}
            photo={photoState.blob}
            photoPending={photoState.loading}
            onSaved={() => setMode(undefined, "updated")}
            onCancel={() => setMode(undefined)}
          />
        </div>
      </>
    );
  }

  const editButton = (
    <Button type="button" onClick={() => setMode("edit")}>
      <Pencil aria-hidden="true" />
      {t("detail.edit")}
    </Button>
  );

  return (
    <>
      <PageHeader back="/customers" actions={editButton} />
      {search.saved && (
        <SavedBanner
          saved={search.saved}
          fromBuy={search.from === "buy"}
          onClose={() => void navigate({ search: (prev) => ({ ...prev, saved: undefined }), replace: true })}
        />
      )}
      <Card
        ref={modeChanged && !search.saved ? focusOnMount : undefined}
        tabIndex={-1}
        aria-labelledby="customer-name"
        className="max-w-3xl gap-4"
      >
        <CardHeader className="flex flex-wrap items-center gap-3">
          <CardTitle id="customer-name" role="heading" aria-level={2} className="text-xl">
            {customer.name_th}
          </CardTitle>
          <CardStatusBadge status={customer.card_status} />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CardStatusNotice
            status={customer.card_status}
            expireText={customer.card_expire_text}
            expireDate={customer.card_expire_date}
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => setMode("edit")}>
                {t("card.edit")}
              </Button>
            }
          />
          <CustomerView customer={customer} photo={photoState} />
        </CardContent>
      </Card>
    </>
  );
}

/** ข้อความยืนยันหลังบันทึก — มาจาก /buy: บอกให้กลับแท็บเดิม (หน้าซื้อเข้าโหลดลูกค้าใหม่เอง) */
function SavedBanner({
  saved,
  fromBuy,
  onClose,
}: {
  saved: "created" | "updated";
  fromBuy: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("customers");
  const [closeFailed, setCloseFailed] = useState(false);
  const closeTab = useCallback(() => {
    window.close();
    // ปิดได้เฉพาะแท็บที่สคริปต์เปิด (window.open) — ปิดไม่ได้ให้บอกทางลัดแทน
    setTimeout(() => setCloseFailed(!window.closed), 300);
  }, []);

  return (
    <Alert role="status" ref={focusOnMount} tabIndex={-1} className="max-w-3xl pr-12">
      <CircleCheck aria-hidden="true" />
      <AlertTitle>{t(saved === "created" ? "detail.created" : "detail.updated")}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3 text-foreground">
        {fromBuy && (
          <>
            <p>{t("detail.backToBuy")}</p>
            <Button type="button" size="sm" onClick={closeTab}>
              {t("detail.closeTab")}
            </Button>
            {closeFailed && <p>{t("detail.closeTabFailed")}</p>}
          </>
        )}
      </AlertDescription>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-2 right-2"
        aria-label={t("detail.dismiss")}
        onClick={onClose}
      >
        <X aria-hidden="true" />
      </Button>
    </Alert>
  );
}

/** ฟอร์มแก้ไข — ค่าเริ่มต้นอ่านครั้งเดียว (refetch เมื่อกลับมาที่แท็บไม่ล้างสิ่งที่กำลังพิมพ์) */
function EditCustomer({
  customer,
  photo,
  photoPending,
  onSaved,
  onCancel,
}: {
  customer: CustomerDetail;
  photo: Blob | undefined;
  photoPending: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const update = useUpdateCustomer(customer.id);
  return (
    <CustomerForm
      mode="edit"
      defaultValues={toFormValues(customer)}
      existingPhoto={photo}
      existingPhotoPending={photoPending}
      onSubmit={async (values) => {
        await update.mutateAsync(values);
        onSaved();
      }}
      onCancel={onCancel}
      renderDuplicateLink={(id, focusable) => <DuplicateLink id={id} focusable={focusable} />}
    />
  );
}

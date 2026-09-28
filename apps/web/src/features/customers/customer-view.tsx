import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { EMPTY, formatThaiDate, formatThaiDateTime } from "@/lib/format";
import { BlobImage } from "./blob-image";
import { SIAM_ID_FIELDS, type TextFieldName } from "./fields";
import { useTranslation } from "./i18n";
import { type CustomerDetail, formatNationalId } from "./model";

interface PhotoState {
  blob?: Blob;
  loading: boolean;
  failed: boolean;
}

/** ค่าในช่องข้อความ — เลขบัตรเต็ม (ที่เดียวที่แสดง · R13) · วันหมดอายุพ่วงวันที่ที่อ่านได้ */
function textValue(customer: CustomerDetail, name: TextFieldName): ReactNode {
  if (name === "national_id") {
    return <span className="font-mono tabular-nums">{formatNationalId(customer.national_id)}</span>;
  }
  const raw = customer[name];
  if (!raw) return EMPTY;
  if (name === "card_expire_text" && customer.card_expire_date) {
    return (
      <>
        {raw} <span className="text-muted-foreground">({formatThaiDate(customer.card_expire_date, "long")})</span>
      </>
    );
  }
  return raw;
}

function PhotoValue({ photo }: { photo: PhotoState }) {
  const { t } = useTranslation("customers");
  if (photo.blob) {
    return (
      <BlobImage
        blob={photo.blob}
        alt={t("detail.photoAlt")}
        className="max-h-64 max-w-full rounded-md border object-contain"
      />
    );
  }
  if (photo.loading) return <Skeleton className="h-48 w-36" />;
  return t(photo.failed ? "detail.photoFailed" : "detail.noPhoto");
}

/**
 * ข้อมูลลูกค้า (อ่านอย่างเดียว) — 11 ช่องเรียงตามลำดับ Siam ID ป้ายชุดเดียวกับฟอร์ม
 * วันที่แสดงข้อความดิบตามที่บันทึก (สถานะบัตรคิดจากข้อความนี้)
 */
export function CustomerView({ customer, photo }: { customer: CustomerDetail; photo: PhotoState }) {
  const { t } = useTranslation("customers");
  return (
    <div className="flex flex-col gap-4">
      <dl className="divide-y">
        {SIAM_ID_FIELDS.map((field) => (
          <div key={field.name} className="grid gap-1 py-2.5 sm:grid-cols-[14rem_1fr] sm:gap-4">
            <dt className="text-sm font-medium text-muted-foreground">{t(`fields.${field.name}.label`)}</dt>
            <dd className="break-words whitespace-pre-line">
              {field.kind === "photo" ? <PhotoValue photo={photo} /> : textValue(customer, field.name)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">
        {t("detail.meta", {
          created: formatThaiDateTime(customer.created_at),
          updated: formatThaiDateTime(customer.updated_at),
        })}
      </p>
    </div>
  );
}

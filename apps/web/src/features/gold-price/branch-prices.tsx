import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { type RefObject, useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError } from "@/lib/api";
import { formatBoardPrice, formatInteger } from "@/lib/format";
import { goldPriceTodayQueryOptions, useMe } from "@/lib/queries";
import { useTranslation } from "./i18n";
import { PriceFormError, PriceInputField, QuotePreview, TypoConfirmDialog } from "./price-form";
import {
  type BranchGoldPrice,
  clearBranchGoldPrice,
  goldPriceBranchesQueryOptions,
  saveBranchGoldPrice,
} from "./queries";
import { requestErrorMessage, usePriceForm } from "./use-price-form";

const SOURCE_BADGE = {
  branch: "default",
  central: "secondary",
  none: "outline",
} as const satisfies Record<string, "default" | "secondary" | "outline">;

/** แถวที่ PUT/DELETE ตอบกลับมา → แทนในตารางทันที (แล้ว invalidate ตามอีกรอบ) */
function patchBranchRow(queryClient: QueryClient, next: BranchGoldPrice) {
  queryClient.setQueryData(goldPriceBranchesQueryOptions.queryKey, (rows) =>
    rows?.map((row) => (row.branch.id === next.branch.id ? next : row)),
  );
}

/** หลังเปลี่ยนราคาของสาขาใด ๆ: หัวหน้า (ราคาของสาขาปัจจุบัน) · การ์ดราคาที่ใช้อยู่ · ตารางนี้ อ่านใหม่ด้วย key ร่วม */
const refreshPrices = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: goldPriceTodayQueryOptions.queryKey });

/** สาขาถูกปิด/ถูกถอนสิทธิ์ระหว่างเปิดหน้า (404) — โหลดรายการใหม่ให้แถวนั้นหายไป */
function refreshOnNotFound(queryClient: QueryClient, error: Error) {
  if (error instanceof ApiError && error.status === 404) {
    void queryClient.invalidateQueries({ queryKey: goldPriceBranchesQueryOptions.queryKey });
  }
}

/**
 * ราคาเฉพาะสาขา (manager · admin) — GET /gold-price/today/branches: ราคาที่แต่ละสาขาใช้จริงวันนี้พร้อมที่มา
 * ตั้งราคาเฉพาะสาขา = PUT (quote/ด่านกันพิมพ์ผิดเดียวกับราคากลาง) · ใช้ราคากลาง = DELETE
 */
export function BranchPricesCard({ className }: { className?: string }) {
  const { t } = useTranslation("goldPrice");
  const titleId = useId();
  const { data: rows, isPending, refetch } = useQuery(goldPriceBranchesQueryOptions);

  return (
    <section aria-labelledby={titleId} aria-busy={isPending} className={className}>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={titleId}>{t("branches.title")}</h2>
          </CardTitle>
          <CardDescription>{t("branches.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {rows === undefined ? (
            isPending ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <div className="grid justify-items-start gap-2">
                <p className="text-destructive">{t("loadFailed", { ns: "common", what: t("branches.title") })}</p>
                <Button variant="outline" size="sm" onClick={() => void refetch()}>
                  {t("retry", { ns: "common" })}
                </Button>
              </div>
            )
          ) : (
            <BranchPriceTable rows={rows} />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function BranchPriceTable({ rows }: { rows: BranchGoldPrice[] }) {
  const { t } = useTranslation("goldPrice");
  const me = useMe();
  const numeric = "px-3 text-right";

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableCaption className="sr-only">{t("branches.caption")}</TableCaption>
        <TableHeader className="bg-muted">
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className="px-3">
              {t("branches.column.branch")}
            </TableHead>
            <TableHead scope="col" className={numeric}>
              {t("goldPrice.barSell", { ns: "common" })}
            </TableHead>
            <TableHead scope="col" className={numeric}>
              {t("goldPrice.barBuy", { ns: "common" })}
            </TableHead>
            <TableHead scope="col" className={numeric}>
              {t("goldPrice.jewelryBuy", { ns: "common" })}
            </TableHead>
            <TableHead scope="col" className="px-3">
              {t("branches.column.source")}
            </TableHead>
            <TableHead scope="col" className={numeric}>
              {t("branches.column.actions")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                {t("branches.empty")}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.branch.id}>
                <TableHead scope="row" className="h-auto px-3 py-2 whitespace-normal">
                  <span className="block">
                    {t("branches.branchLabel", { code: row.branch.code, name: row.branch.name })}
                  </span>
                  {row.branch.id === me.branch?.id && (
                    <span className="block text-sm font-normal text-muted-foreground">{t("branches.current")}</span>
                  )}
                </TableHead>
                <TableCell className={`${numeric} tabular-nums`}>{formatBoardPrice(row.bar_sell)}</TableCell>
                <TableCell className={`${numeric} tabular-nums`}>{formatBoardPrice(row.bar_buy)}</TableCell>
                <TableCell className={`${numeric} tabular-nums`}>{formatInteger(row.jewelry_buy)}</TableCell>
                <TableCell className="px-3">
                  <Badge variant={SOURCE_BADGE[row.source ?? "none"]}>
                    {t(`branches.source.${row.source ?? "none"}`)}
                  </Badge>
                </TableCell>
                <TableCell className="px-3">
                  <BranchPriceActions row={row} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** ปุ่มของแถว — แต่ละแถวมี Dialog/AlertDialog ของตัวเอง ปิดแล้วโฟกัสกลับปุ่มที่เปิด (Radix คืนให้ผ่าน Trigger) */
function BranchPriceActions({ row }: { row: BranchGoldPrice }) {
  const { t } = useTranslation("goldPrice");
  const setButtonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const branch = row.branch.name;

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button ref={setButtonRef} variant="outline" size="sm" aria-label={t("branches.setFor", { branch })}>
            {t("branches.set")}
          </Button>
        </DialogTrigger>
        <DialogContent showCloseButton={false}>
          <SetBranchPriceForm row={row} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
      {row.source === "branch" && <ClearBranchPrice row={row} fallbackFocus={setButtonRef} />}
    </div>
  );
}

/**
 * ฟอร์มใน Dialog — ช่องเดียว · quote สดพร้อม branch_id · Enter บันทึก · 409 → ยืนยันแบบเดียวกับราคากลาง
 * mount ใหม่ทุกครั้งที่เปิด (DialogContent ไม่ render ตอนปิด) ช่องจึงว่างเสมอ
 */
function SetBranchPriceForm({ row, onDone }: { row: BranchGoldPrice; onDone: () => void }) {
  const { t } = useTranslation("goldPrice");
  const queryClient = useQueryClient();
  const branch = row.branch.name;
  const inputRef = useRef<HTMLInputElement>(null);
  const form = usePriceForm({
    inputRef,
    branchId: row.branch.id,
    save: (body) => saveBranchGoldPrice({ branchId: row.branch.id, ...body }),
    onSaved: async (saved) => {
      toast.success(t("branchDialog.saved", { branch }), {
        description: t("savedDescription", { price: formatBoardPrice(saved.bar_sell) }),
      });
      patchBranchRow(queryClient, saved);
      onDone();
      await refreshPrices(queryClient);
    },
    onFailed: (error) => refreshOnNotFound(queryClient, error),
  });

  return (
    <form noValidate onSubmit={form.submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("branchDialog.title", { branch })}</DialogTitle>
        <DialogDescription>{t("branchDialog.description")}</DialogDescription>
      </DialogHeader>
      <p className="text-sm">
        {row.bar_sell && row.source
          ? t("branchDialog.current", {
              price: formatBoardPrice(row.bar_sell),
              source: t(`goldPrice.source.${row.source}`, { ns: "common" }),
            })
          : t("branchDialog.currentNone")}
      </p>
      <PriceFormError form={form} />
      <PriceInputField form={form} inputRef={inputRef} label={t("branchDialog.label")} autoFocus />
      {/* API ปฏิเสธราคาต่อกรัมที่ราคาเฉพาะสาขา — บอกไว้ตรงนี้ ผู้จัดการจะได้ไม่หาช่อง */}
      <p className="text-sm text-muted-foreground">{t("branchDialog.perGramNote")}</p>
      <QuotePreview form={form} />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {t("branchDialog.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={form.saving}>
          {form.saving && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {form.saving ? t("saving", { ns: "common" }) : t("branchDialog.save")}
        </Button>
      </DialogFooter>
      <TypoConfirmDialog form={form} title={t("typo.branchTitle", { branch })} />
    </form>
  );
}

/**
 * ใช้ราคากลาง (DELETE) — ยืนยันด้วย AlertDialog โฟกัสเริ่มที่ "ยกเลิก"
 * ยืนยันแล้วปุ่มนี้หายไป (สาขากลับไปใช้ราคากลาง) จึงส่งโฟกัสไปที่ปุ่มตั้งราคาของแถวเดียวกัน
 */
function ClearBranchPrice({
  row,
  fallbackFocus,
}: {
  row: BranchGoldPrice;
  fallbackFocus: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation("goldPrice");
  const queryClient = useQueryClient();
  const confirmed = useRef(false);
  const branch = row.branch.name;
  const clear = useMutation({
    mutationFn: clearBranchGoldPrice,
    onSuccess: async (cleared) => {
      toast.success(t("clearDialog.done", { branch }));
      patchBranchRow(queryClient, cleared);
      await refreshPrices(queryClient);
    },
    onError: (error) => {
      toast.error(requestErrorMessage(t, error, "clear"));
      refreshOnNotFound(queryClient, error);
    },
  });

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (open) confirmed.current = false;
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={clear.isPending} aria-label={t("branches.clearFor", { branch })}>
          {clear.isPending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {t("branches.clear")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (!confirmed.current) return;
          event.preventDefault();
          fallbackFocus.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t("clearDialog.title", { branch })}</AlertDialogTitle>
          <AlertDialogDescription>{t("clearDialog.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("clearDialog.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              confirmed.current = true;
              clear.mutate(row.branch.id);
            }}
          >
            {t("clearDialog.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { cn } from "@/lib/utils";
import { type CustomerListItem, normalizeQuery } from "@/features/customers/model";
import { customerListQuery } from "@/features/customers/queries";
import { useTranslation } from "../i18n";
import type { BuyController } from "../use-buy-controller";
import { useSiamIdCapture } from "../use-siam-id-capture";

const SEARCH_DEBOUNCE_MS = 250;

/**
 * ค้นลูกค้าด้วยชื่อ/เลขบัตร/เบอร์ — combobox ตาม WAI-ARIA (ช่องพิมพ์ + listbox · aria-activedescendant)
 * รายการอยู่ในหน้าเดียวกัน (ไม่ใช่ portal) จึงไม่แย่งโฟกัสจากช่อง · ↑↓ เลือก · Enter ยืนยัน · Esc ปิด/ล้าง
 * ถ้าข้อความกลายเป็นเลข 13 หลักพอดี (Siam ID พิมพ์ลงช่องนี้) ค้นด้วยเลขบัตรแบบเดียวกับช่องเลขบัตร
 */
export function CustomerSearch({ c }: { c: BuyController }) {
  const { t } = useTranslation("buy");
  const id = useId();
  const { state, actions, register } = c;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const term = normalizeQuery(state.searchText);
  const settled = useDebouncedValue(term, SEARCH_DEBOUNCE_MS);
  const searchable = settled.length >= 2 && term.length >= 2;
  const list = useQuery({ ...customerListQuery({ q: settled, page: 1 }), enabled: searchable });
  const items: readonly CustomerListItem[] = searchable && !list.isPlaceholderData ? (list.data?.items ?? []) : [];
  const expanded = open && items.length > 0;
  const activeIndex = Math.min(active, items.length - 1);
  const optionId = (i: number) => `${id}-option-${i}`;

  const capture = useSiamIdCapture({
    value: state.searchText,
    onValueChange: (text) => {
      actions.typeSearch(text);
      setOpen(true);
      setActive(0);
    },
    onNationalId: actions.findByNationalId,
  });

  const pick = (item: CustomerListItem) => {
    setOpen(false);
    actions.pickCustomer(item, term);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    capture.inputProps.onKeyDown(e);
    if (e.defaultPrevented || e.nativeEvent.isComposing || e.ctrlKey || e.metaKey) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setOpen(true);
        setActive(Math.min(activeIndex + 1, items.length - 1));
        return;
      case "ArrowUp":
        e.preventDefault();
        setActive(Math.max(activeIndex - 1, 0));
        return;
      case "Enter": {
        e.preventDefault();
        const item = items[activeIndex];
        if (expanded && item) pick(item);
        return;
      }
      case "Escape":
        if (expanded) {
          e.preventDefault();
          setOpen(false);
        } else if (state.searchText) {
          e.preventDefault();
          capture.cancel();
          actions.typeSearch("");
        }
        return;
      case "Tab":
        setOpen(false);
    }
  };

  const status =
    term.length === 0
      ? t("customer.searchHint")
      : term.length < 2
        ? t("customer.searchHint")
        : list.isError
          ? t("customer.searchFailed")
          : !searchable || list.isFetching
            ? t("customer.searching")
            : items.length === 0
              ? t("customer.searchEmpty")
              : t("customer.resultCount", { count: items.length });

  return (
    <Field className="relative">
      <FieldLabel htmlFor={`${id}-q`}>{t("customer.searchLabel")}</FieldLabel>
      <Input
        ref={(el) => register("search", el)}
        id={`${id}-q`}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        placeholder={t("customer.searchPlaceholder")}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={expanded ? optionId(activeIndex) : undefined}
        aria-describedby={`${id}-status`}
        value={capture.inputProps.value}
        onChange={capture.inputProps.onChange}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      <FieldDescription id={`${id}-status`} aria-live="polite">
        {status}
      </FieldDescription>
      <ul
        id={`${id}-listbox`}
        role="listbox"
        aria-label={t("customer.results")}
        hidden={!expanded}
        className="absolute top-[4.25rem] right-0 left-0 z-30 max-h-80 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      >
        {items.map((item, i) => (
          <li
            key={item.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === activeIndex}
            // คลิกแล้วช่องพิมพ์ยังไม่เสียโฟกัส (ไม่ปิดรายการก่อนเลือก)
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(item)}
            onMouseMove={() => setActive(i)}
            className={cn(
              "flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-0.5 rounded-sm px-3 py-2",
              i === activeIndex && "bg-accent text-accent-foreground outline-2 outline-ring",
            )}
          >
            <span className="font-semibold">{item.name_th}</span>
            <span className="text-sm tabular-nums text-muted-foreground">{item.national_id_masked}</span>
            {item.mobile && <span className="text-sm tabular-nums text-muted-foreground">{item.mobile}</span>}
            {item.card_status !== "ok" && (
              <Badge variant="destructive">{t(`customer.cardBadge.${item.card_status}`)}</Badge>
            )}
          </li>
        ))}
      </ul>
    </Field>
  );
}

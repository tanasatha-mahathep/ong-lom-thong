import { FilterX } from "lucide-react";
import { type KeyboardEvent, useEffect, useEffectEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ROLES } from "@/lib/queries";
import type { AdminBranch } from "./api";
import { useTranslation } from "./i18n";
import type { UsersSearch } from "./users-search";

const DEBOUNCE_MS = 300;

/** ตัวกรองรายชื่อผู้ใช้ — ทุกค่าอยู่ใน URL (ผู้เรียก navigate) · เลือกแล้วกรองทันที */
export function UserFilters({
  search,
  branches,
  onChange,
}: {
  search: UsersSearch;
  branches: readonly AdminBranch[];
  onChange: (patch: Partial<UsersSearch>) => void;
}) {
  const { t } = useTranslation("settings");
  const ids = useId();
  const filtered =
    search.q !== "" || search.branch !== undefined || search.role !== undefined || search.active !== undefined;
  // ล้างตัวกรอง = เริ่มช่องค้นใหม่ (ทิ้งคำที่ยังพิมพ์ค้างอยู่)
  const [generation, setGeneration] = useState(0);

  return (
    <form
      role="search"
      aria-label={t("users.filters.label")}
      onSubmit={(event) => event.preventDefault()}
      className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(16rem,2fr)_repeat(3,minmax(10rem,1fr))_auto]"
    >
      <SearchField key={generation} id={`${ids}-q`} q={search.q} onSearch={(q) => onChange({ q })} />

      <Field>
        <FieldLabel htmlFor={`${ids}-branch`}>{t("users.filters.branch.label")}</FieldLabel>
        <NativeSelect
          id={`${ids}-branch`}
          value={search.branch ?? ""}
          onChange={(event) => onChange({ branch: event.target.value || undefined })}
        >
          <NativeSelectOption value="">{t("users.filters.branch.all")}</NativeSelectOption>
          {branches.map((branch) => {
            const label = t("branchLabel", { code: branch.code, name: branch.name });
            return (
              <NativeSelectOption key={branch.id} value={branch.id}>
                {branch.is_active ? label : t("users.branchClosed", { branch: label })}
              </NativeSelectOption>
            );
          })}
        </NativeSelect>
      </Field>

      <Field>
        <FieldLabel htmlFor={`${ids}-role`}>{t("users.filters.role.label")}</FieldLabel>
        <NativeSelect
          id={`${ids}-role`}
          value={search.role ?? ""}
          onChange={(event) => onChange({ role: ROLES.find((role) => role === event.target.value) })}
        >
          <NativeSelectOption value="">{t("users.filters.role.all")}</NativeSelectOption>
          {ROLES.map((role) => (
            <NativeSelectOption key={role} value={role}>
              {t(`roles.${role}`, { ns: "common" })}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>

      <Field>
        <FieldLabel htmlFor={`${ids}-active`}>{t("users.filters.active.label")}</FieldLabel>
        <NativeSelect
          id={`${ids}-active`}
          value={search.active === undefined ? "" : String(search.active)}
          onChange={(event) => {
            const value = event.target.value;
            onChange({ active: value === "" ? undefined : value === "true" });
          }}
        >
          <NativeSelectOption value="">{t("users.filters.active.all")}</NativeSelectOption>
          <NativeSelectOption value="true">{t("users.filters.active.active")}</NativeSelectOption>
          <NativeSelectOption value="false">{t("users.filters.active.inactive")}</NativeSelectOption>
        </NativeSelect>
      </Field>

      <Button
        type="button"
        variant="ghost"
        // แถวเดียว (xl): ตรงกับช่องเลือก = สูงป้าย (text-sm × leading-snug) + gap-3 ของ Field
        className="self-start xl:mt-[1.953125rem]"
        disabled={!filtered}
        onClick={() => {
          setGeneration((n) => n + 1);
          onChange({ q: "", branch: undefined, role: undefined, active: undefined });
        }}
      >
        <FilterX aria-hidden="true" />
        {t("users.filters.clear")}
      </Button>
    </form>
  );
}

/**
 * ช่องค้นชื่อ/อีเมล — พิมพ์แล้วรอ 300 ms จึงกรอง · Enter กรองทันที · Esc ล้าง
 * q ใน URL เปลี่ยนจากภายนอก (ย้อนกลับ/ลิงก์) ช่องตาม
 */
function SearchField({ id, q, onSearch }: { id: string; q: string; onSearch: (q: string) => void }) {
  const { t } = useTranslation("settings");
  const [draft, setDraft] = useState(q);
  // คำค้นล่าสุดที่ช่องนี้ส่งเอง — q ใน URL ต่างจากนี้ = เปลี่ยนจากภายนอก
  const [committed, setCommitted] = useState(q);
  if (q !== committed) {
    setCommitted(q);
    setDraft(q);
  }

  const commit = (value: string) => {
    const term = value.trim();
    if (term === committed) return;
    setCommitted(term);
    onSearch(term);
  };
  const term = draft.trim();
  const onDebounced = useEffectEvent(commit);
  useEffect(() => {
    if (term === committed) return;
    const timer = setTimeout(() => onDebounced(term), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, committed]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Escape" && draft !== "") {
      event.preventDefault();
      setDraft("");
      commit("");
    }
  };

  return (
    <Field>
      <FieldLabel htmlFor={id}>{t("users.filters.q.label")}</FieldLabel>
      <Input
        id={id}
        type="search"
        autoComplete="off"
        spellCheck={false}
        maxLength={100}
        placeholder={t("users.filters.q.placeholder")}
        aria-describedby={`${id}-hint`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <FieldDescription id={`${id}-hint`}>{t("users.filters.q.hint")}</FieldDescription>
    </Field>
  );
}

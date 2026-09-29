---
name: web-page
description: สร้างหรือแก้หน้าใน apps/web (Vite + React + TanStack Router/Query + Tailwind 4 + shadcn/ui) ของร้านทอง — เงินเป็น string จาก API ห้ามคำนวณเงินใน browser ฟอร์ม Siam ID คีย์บอร์ดล้วน ใช้ทุกครั้งที่แตะ apps/web
---

# web-page

## โครง

- route แบบ file-based ใน `apps/web/src/routes/` (TanStack Router plugin generate `routeTree.gen.ts` — commit ไฟล์ที่ generate) · server state ผ่าน TanStack Query
- ทุกหน้าหลัง login อยู่ใต้ `_app.tsx` (guard + shell ของ dashboard-01) — route ทั้งหมดใน spec §3 **มีไฟล์แล้ว** เป็น stub (`component: PagePlaceholder`) → งานหน้า = แทน `component` ในไฟล์เดิม ไม่สร้าง route ใหม่ (routeTree ไม่ชนกัน)
- ชื่อหน้า: `staticData: { title: "<key>", crumbs? }` — key ใน `shell.routes` (`src/i18n/locales/th.ts`) · หัวหน้า breadcrumb และ `document.title` แปลเอง · หัวเรื่องในเนื้อหาใช้ `<PageHeader description? actions? />` (h1 เดียวของหน้า)
- ไฟล์เทสต์ห้ามอยู่ใน `src/routes/` (plugin จะนับเป็น route) — วางข้าง component หรือใน `src/test/`
- API origin เดียวกับ SPA (`/api/...`, cookie session ของ better-auth) · dev: vite proxy `/api` → `http://localhost:${API_PORT:-8787}` · หลายชุดพร้อมกัน: `WEB_PORT=5181 API_PORT=8791 make dev`
- สัญญา API: `../Work_2026-09-27/05-spec-vite-tanstack.md` §5 และโค้ดจริงใน `apps/api/src/routes/*.ts`

## ข้อความ (i18n) — ภาษาไทยอย่างเดียวตอนนี้ ภาษาอังกฤษภายหลัง

- **ห้ามมีข้อความไทย/อังกฤษใน JSX** รวม `aria-label` · placeholder · toast · error — ทุกคำอยู่ในไฟล์ locale แล้วเรียก `t()`
- namespace ตาม feature: `src/features/<ns>/locales/th.ts` → `export default { … }` (object ธรรมดา **ห้าม `as const`**) · ลงทะเบียนไว้แล้วใน `src/i18n/resources.ts`: `common` `shell` `auth` `home` `goldPrice` `customers` `buy` `bills` `reports` `settings` — namespace ใหม่ = import หนึ่งบรรทัด + key หนึ่งตัวในไฟล์นั้น
- ใช้: `const { t } = useTranslation("buy"); t("save")` · ข้าม namespace: `t("retry", { ns: "common" })` · ตัวแปร: `"ยอด {{amount}} บาท"` → `t("total", { amount: formatMoney(x) })` · นอก component: `i18next.getFixedT(null, "buy")` (import จาก `@/i18n`)
- key ถูกตรวจตอน typecheck (`src/i18n/i18next.d.ts`) — พิมพ์ผิด = compile error
- คำกลางอยู่ใน `common` แล้ว: `retry` `saving` `baht` `noBranch` `branchCode` `loadFailed` `goldPrice.*` `roles.*` `errors.*` — อย่าสร้างซ้ำใน namespace ของหน้า
- ข้อความจาก API เป็นไทย (`@ong/core`) แสดงผ่าน `errorMessage(e)` · ตอนเพิ่มภาษาอังกฤษต้อง map `field` + status เป็นคำแปล (ยังไม่ได้ทำ)
- ภาษาอังกฤษภายหลัง: `en.ts` ข้าง `th.ts` ทุกไฟล์ (`import type th from "./th"; export default { … } satisfies typeof th;`) + `en` ใน resources และ supportedLngs + ตัวเลือกภาษา — `format.ts` ยังเป็น th-TH

## ธีม (สว่าง · มืด · ตามระบบ)

- ใช้ **token เท่านั้น**: `bg-background` `text-foreground` `text-muted-foreground` `bg-card` `bg-muted` `border` `border-input` `bg-primary` `text-destructive` · เตือน `bg-warning text-warning-foreground border-warning-border` · สำเร็จ (เช่น "ชำระเงินครบถ้วน") `bg-success text-success-foreground border-success-border` — **ห้ามสีดิบ** (`bg-white` `text-black` `gray-500` `amber-50` …) เพราะโหมดมืดจะไม่เปลี่ยนตาม
- สิ่งที่ต้องต่างกันจริงระหว่างธีมใช้ `dark:` (ทำงานบนจอเท่านั้น) · WCAG 2.2 AA ทั้งสองธีม: ตัวอักษร ≥ 4.5:1 · ขอบช่องกรอก/โฟกัส ≥ 3:1 (token ผ่านแล้ว)
- **พิมพ์ = สว่างเสมอ** (token มืดอยู่ใน `@media screen`) · ใบรับซื้อ/สำเนาบัตรที่แสดงบนจอ ครอบด้วย `className="theme-light"` ให้สว่างแม้แอปเป็นโหมดมืด
- ธีมเก็บใน localStorage `ong.theme` · `public/theme-init.js` ตั้ง `.dark` ก่อนวาดหน้า (CSP ห้าม inline script — ห้ามเพิ่ม `<script>` แบบ inline ใน index.html)

## data layer (`src/lib/`)

- `apiFetch(path, { json | form, schema?, signal })` — same-origin + `credentials: "same-origin"` · error = `ApiError {status, error, field?, body}` (status 0 = ติดต่อไม่ได้) · ใส่ `schema` (zod) ตรวจคำตอบที่ขอบ API · เงินใน schema ใช้ `decimalString`
- query options ใช้ `queryOptions()` ของ TanStack Query v5 ต่อ endpoint (ดู `meQueryOptions` / `goldPriceTodayQueryOptions` ใน `queries.ts`) · loader: `context.queryClient.ensureQueryData(x)` · component: `useQuery(x)` / `useSuspenseQuery(x)`
- ผู้ใช้ปัจจุบัน: `useMe()` (role · branch · branches) — ห้ามอ่าน me จาก route context (ไม่อัปเดตหลังสลับสาขา)
- 401 จาก query/mutation ใดก็ได้ → ตัวดักกลางใน `router.tsx` พาไป `/login?redirect=…` เอง · ยกเว้นตั้ง `meta: { handlesUnauthorized: true }`
- error ใต้ช่อง: `ApiError.field` → `<FieldError id=…>` + `aria-describedby` ที่ input · ข้อความรวม: `errorMessage(e)` (ไทยเสมอ — ข้อความอังกฤษจาก API แปลตาม status)
- deploy ใหม่ระหว่างเปิดแท็บ: chunk เก่าหาย → `ErrorPage` บอก "มีเวอร์ชันใหม่" + reload เองครั้งเดียว · preload ล้ม → toast ปุ่มรีเฟรช (`src/lib/app-update.ts`) — หน้าไม่ต้องทำอะไรเพิ่ม
- สลับสาขาแล้ว **reset** ทุก query ยกเว้น `me` (ข้อมูลสาขาเดิมหายทันที ไม่ค้างใต้หัวสาขาใหม่) — query key ไม่ต้องใส่ branch id แต่หน้าต้องรับสถานะ "ยังไม่มีข้อมูล" (skeleton) ได้เสมอ

## shadcn/ui

- style new-york · สี neutral · Tailwind 4 · component อยู่ `src/components/ui/` · เพิ่มด้วย `pnpm dlx shadcn@latest add <ชื่อ>` ใน `apps/web` (แล้ว `pnpm exec prettier --write` ไฟล์ใหม่) · MCP `shadcn` ใน `.mcp.json` ใช้ค้น registry
- component ใน `ui/` แก้แล้วบางตัว — **ห้าม `add --overwrite`**: `sidebar` (SidebarInset เป็น `<div>`, ป้ายไทย, skeleton ไม่สุ่ม) · `input` (พื้นทึบ `bg-background`) · `breadcrumb` (หน้าปัจจุบันไม่ใช่ role=link, ป้ายไทย) · `sonner` (ไม่ใช้ next-themes) · `sheet` (ป้ายไทย)
- ไอคอน `lucide-react` ชุดเดียว · ไอคอนประดับใส่ `aria-hidden="true"` · ปุ่มไอคอนล้วนต้องมี `aria-label` หรือ `sr-only`
- block ที่ใช้: `dashboard-01` (app-sidebar · nav-main · nav-user · site-header) · `login-04` (login-form) — ส่วน demo ถูกลบแล้ว
- ตาราง: `<DataTable columns data caption page hasMore onPageChange onRowClick? isLoading?>` (`src/components/data-table.tsx`) — TanStack Table · แบ่งหน้าฝั่งเซิร์ฟเวอร์ด้วย `page` + `has_more` (ไม่มียอดรวมแถว) · คอลัมน์เงินใส่ `meta: { numeric: true }` · **คอลัมน์หลัก (เลขที่บิล/ชื่อลูกค้า) ต้องเป็น `<Link>` จริง** = ทางของคีย์บอร์ด/screen reader (แถวไม่รับโฟกัส) · `onRowClick` เป็นแค่ทางลัดของเมาส์ (คลิกโดนลิงก์/ปุ่มในแถวไม่เรียกซ้ำ)

## เงินและตัวเลข

- เงิน/น้ำหนักเก็บและส่งเป็น **string** เสมอ · **ห้ามคำนวณเงินใน browser** — ยอดรวม ราคา/กรัม คงเหลือ ฯลฯ มาจาก API (`/buy/quote`, `/gold-price/quote`)
- แสดงผลด้วย `src/lib/format.ts` เท่านั้น: `formatMoney` (2) · `formatWeight` (3) · `formatInteger` (ราคาทองรูปพรรณ 0) · `formatThaiDate` / `formatThaiDateTime` (พ.ศ.) — รับข้อความทศนิยมตรง ๆ ไม่ผ่าน `Number` · คู่กับ class `tabular-nums`
- เลขบัตรแสดงเต็มเฉพาะหน้าลูกค้าเดี่ยว · ที่อื่นใช้ `national_id_masked` จาก API

## Form rules (U0–U6) — ทุกฟอร์มใช้ชุดนี้

หน้าอ้างอิง: `src/components/login-form.tsx` (+ เทสต์ `login-form.test.tsx`) · ห้ามสร้างกลไกเดียวกันซ้ำในหน้า

| กฎ                                           | ใช้                                                                                                               | ไฟล์                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| U0 floating label · U1 placeholder ตัวอย่าง  | `FloatingInput` `FloatingTextarea` `FloatingSelect` (+ `NativeSelectOption`) · `size="compact"` หน้าซื้อเข้า      | `components/ui/floating-field.tsx` |
| U2 ตรวจก่อนส่ง · U3 error ของ API · U5 toast | `useAppForm({ defaultValues, schema, submit, onSuccess?, successMessage? })`                                      | `hooks/use-app-form.ts`            |
| U4 ระหว่างส่ง                                | `<AppForm form={f}>` (`<fieldset disabled>` + `aria-busy`) · `<SubmitButton form={f}>` (หมุน + "กำลังบันทึก…")    | `components/app-form.tsx`          |
| U5 toast นอกฟอร์ม                            | `notifySuccess(msg)` (หายเอง 4 วิ) · `notifyError(msg)` (ค้างจนปิด) — ห้าม `toast.*` ตรง ๆ                        | `lib/notify.ts`                    |
| U6 ชั้นบังหน้าจอ                             | `useBlockingNavigate()` หลังบันทึก/login · `reloadBlocking()` · `runBlocking(fn)` — **ไม่ใช้กับเมนู/ลิงก์ธรรมดา** | `lib/blocking.ts`                  |

```tsx
const { t } = useTranslation("customers");
const navigate = useBlockingNavigate();
const schema = useMemo(
  () =>
    z.object({
      name_th: z.string().trim().min(1, t("validation.nameRequired")),
      mobile: z.string().regex(/^(0\d{2}-?\d{3}-?\d{4})?$/, t("validation.mobile")),
    }),
  [t],
);
const f = useAppForm({
  defaultValues: { name_th: "", mobile: "" },
  schema, // ข้อความใน schema = แปลแล้ว
  submit: (values) => createCustomer(values), // values = schema.parse แล้ว (trim แล้ว) · throw ApiError → error ใต้ช่อง + toast
  successMessage: (c) => t("saved", { name: c.name_th }),
  onSuccess: (c) => navigate({ to: "/customers/$id", params: { id: c.id } }), // ฟอร์มยังปิดจนไปถึง
  // submitOnEnter: false,                   // ฟอร์ม Siam ID: บันทึกด้วยปุ่ม/Ctrl+Enter เท่านั้น
});
return (
  <AppForm form={f} className="flex flex-col gap-5">
    <f.form.Field name="mobile">
      {(field) => (
        <FloatingInput
          {...f.bind(field)}
          label={t("fields.mobile")}
          placeholder={t("placeholders.mobile")}
          inputMode="tel"
        />
      )}
    </f.form.Field>
    <SubmitButton form={f}>{t("save")}</SubmitButton>
  </AppForm>
);
```

- `f.bind(field)` คืน `id name value onChange onBlur error` (ช่องค่าเป็น string) — ช่องอื่น (checkbox/radio) ใช้ `field.handleChange` + `f.errorOf(field)` เอง · `name` ต้องอยู่บนช่องจริง (ใช้หาช่องแรกที่ผิดตามลำดับ DOM)
- ทุกช่องมี `placeholder` = ตัวอย่าง/รูปแบบจาก locale (`วว/ดด/ปปปป` · `081-234-5678` · `0.000`) — โปร่งใสจนโฟกัส ไม่ใช่ป้าย · `FloatingInput`/`FloatingTextarea` บังคับ prop นี้ใน type (ไม่มีตัวอย่างที่มีความหมายจริง ๆ ส่ง `""`)
- `submit` / `onSuccess` / `successMessage` ได้ค่า **output ของ `schema.parse`** (trim · pipe · transform แล้ว) ไม่ใช่ข้อความดิบในช่อง — ไม่ต้อง trim ซ้ำ · refine ที่ไม่มี `path` = error ของทั้งฟอร์ม → `f.formError` + toast + โฟกัสปุ่มบันทึก
- จังหวะ error: ไม่แสดงระหว่างพิมพ์ครั้งแรก → แสดงเมื่อออกจากช่อง → หลังจากนั้นอัปเดตทุกครั้งที่พิมพ์ · กดบันทึกทั้งที่ผิด = แสดงทุกช่อง + โฟกัสช่องแรกที่ผิด · ไม่ต้องเขียน `onBlur`/`onSubmitInvalid` เอง
- error ของ API: ค่าเริ่มต้น `ApiError.field` — path แบบ API แปลงเป็นชื่อช่อง TanStack ให้เอง (`lines.1.weight_g` → `lines[1].weight_g`) · ไม่มีช่องนั้นในฟอร์ม → ลองช่องแม่ (`allowed_branch_ids.1` → `allowed_branch_ids`) · เจอ → ใต้ช่องนั้น + โฟกัส · ไม่เจอ = error ของทั้งฟอร์ม · ชื่อไม่ตรง/ต้องแปลข้อความเอง → `fieldOfError` / `errorMessage` (เช่น `mapServerError` ของ customers) · ไม่ชี้ช่อง → toast + `f.formError` (แสดง Alert ในฟอร์มด้วยได้) + โฟกัสปุ่มบันทึก หรือ `focusOnFormError`
- **ห้ามคำนวณเงิน/น้ำหนักใน schema หรือ submit** (ตรวจแค่รูปแบบ · ส่งข้อความทศนิยมให้ API) · idempotency key ของบิลยังเป็นหน้าที่ของหน้า
- บันทึกสำเร็จแต่ `onSuccess` throw (นำทาง/พิมพ์ล้ม) ≠ บันทึกไม่สำเร็จ: ฟอร์ม **ล็อกค้าง** (`f.saved` = true · ส่งซ้ำไม่ได้ กันบิลซ้ำ) + toast "บันทึกแล้ว แต่เปิดหน้าถัดไปไม่ได้" · `f.reset()` ปลดล็อกพร้อมล้างค่า (เช่น ปุ่ม "เริ่มบิลใหม่")
- toast ของฟอร์มหนึ่งใช้ id เดียว: ล้มซ้ำไม่กองกัน · เริ่มส่งใหม่ = toast error เดิมหาย · สำเร็จ = แทนที่ด้วย toast สำเร็จ
- ชั้นบังหน้าจอเปิด/ปิดผ่าน helper เท่านั้น (นับซ้อน · ปิดใน `finally`) · มี watchdog 25 วินาที (loader ค้าง / navigation ถูกยกเลิก) → เลิกบัง + toast error · `reloadBlocking()` / `navigate({ reloadDocument })` / href ไปเว็บอื่น บังจนหน้าหาย ถ้าถูกยกเลิก (beforeunload "อยู่ต่อ") เลิกบังเองหลัง 5 วินาที · toaster อยู่นอก `#root` (portal ที่ body) จึงยังประกาศ toast ระหว่างบัง · เทสต์รีเซ็ตให้ใน `src/test/setup.ts`
- เทสต์ของหน้า: ป้ายหาได้ด้วย `getByLabelText` ตามเดิม · error อยู่ใน `toHaveAccessibleDescription` · ระหว่างส่ง `toBeDisabled()` · toast ค้นด้วยข้อความ / ปุ่ม "ปิดการแจ้งเตือน" · ชั้นบัง `getByRole("dialog", { name: "กำลังทำงาน…" })`

## วันที่ · ตัวกรอง · ความกว้างหน้า (รายการ/รายงาน)

- **วันที่ที่แสดง = `วว/ดด/ปปปป` พ.ศ.** ทุกตาราง/ข้อความบรรยาย · วันที่+เวลา = `29/09/2569 17:56` (`formatDocDateTime` ใน `lib/thai-date.ts`) — ไม่ใช้ "29 ก.ย. 2569" ในตาราง (`formatThaiDate` ไว้ให้หัวการ์ดที่ต้องอ่านง่ายเท่านั้น)
- **ช่องวันที่พิมพ์เอง = `<ThaiDateField>`** (`components/thai-date-field.tsx`): placeholder `วว/ดด/ปปปป` + คำแนะนำใต้ช่อง + error ชุดเดียว (`common.dateField.*`) · ตรวจด้วย `parseDateField` (`required` · `invalid` · `tooEarly` ก่อน ค.ศ. 2000) · ช่วงกลับด้าน (ตั้งแต่ > ถึง) = error ที่ช่อง "ถึง" ก่อนยิง API
- **ตัวกรองทุกหน้าใช้กติกาเดียว:** ตัวเลือก (โลหะ · สาขา) และปุ่มลัดช่วงวันที่ = ใช้ทันที · ค้นหาข้อความ = หน่วง 300 ms หรือ Enter · วันที่ที่พิมพ์: รายการเบา (ค้นบิล) ใช้เมื่อ blur/Enter · **รายงานหนัก (ยอดซื้อ · สต็อก) ใช้เมื่อ Enter หรือปุ่ม "แสดงรายงาน"** เพราะคำนวณยอดรวมทั้งช่วง — ไม่ยิงทุกครั้งที่ออกจากช่อง · ระหว่างโหลดปุ่มกดไม่ได้ + หมุน
- **ไฟล์ดาวน์โหลดที่ต้องรู้ผล** (CSV): ขอผ่าน `apiBlob` + `navigation.saveBlob` ปุ่มหมุนระหว่างโหลด · toast สำเร็จ/ล้มเหลว (`notifySuccess`/`notifyError`) · ไฟล์ใหญ่ (zip) ยังใช้ HEAD เช็คแล้ว `navigation.downloadAt` — ห้าม fetch เข้าหน่วยความจำ
- **หน้าไม่ล้นแนวนอน** (1366 · 1024 · 768 · 390): `SidebarInset`/`<main>` มี `min-w-0` · grid ที่ถือตารางใช้ `grid-cols-1` (ไม่ใช่ track `auto`) · ตารางอยู่ในกล่อง `overflow-x-auto` ของตัวเอง (`Table`) — เทสต์ `src/test/layout.test.tsx` ตรวจสัญญานี้
- ป้ายสถานะ "ยกเลิก" = `<Badge variant="destructive">` เหมือนหน้าใบรับซื้อ

## ฟอร์มลูกค้า — Siam ID (CLAUDE.md กฎ 6)

- 11 ช่องเรียงตาม `../Work_2026-09-27/03-customer-member.md` **ห้ามสลับ** · ลำดับ DOM = ลำดับ Tab
- ใน 11 ช่องใช้แค่ shadcn `Input` / `Textarea` หรือ `FloatingInput` / `FloatingTextarea` (สร้างบนตัวเดียวกัน · ค่าเริ่มต้น `type="text"`) — **ห้าม `Select` / `FloatingSelect` · `Calendar` · `DatePicker` · Combobox** (ป๊อปอัปแย่งโฟกัสจาก Siam ID) · `useAppForm({ submitOnEnter: false })`
- element อื่นที่รับ focus ได้ระหว่างช่อง (ปุ่ม ลิงก์ โซนวางรูป) → `tabIndex={-1}` · ช่องวันที่ `<input type="text">` ห้าม date picker / input mask
- `autoComplete="off"` · Enter ไม่ submit (submit ด้วยปุ่มหรือ `Ctrl+Enter`) · format หลัง blur เท่านั้น
- รูป: โซน `onPaste` (`clipboardData.files[0]`) + `<input type="file" accept="image/*">` + preview · ส่ง multipart (`apiFetch(path, { form })`)

## UX / a11y (WCAG 2.2 AA)

- ภาษาไทยทั้งหมด (ผ่าน `t()`) · ฟอนต์ Sarabun (`/fonts`) · การ์ด/ตาราง/ฟอร์มเงินพื้นทึบ (`bg-card` / `bg-background` ห้ามโปร่ง) · `:focus-visible` เส้นน้ำเงิน 2px มาจาก `styles.css` อยู่แล้ว
- ทุก input มี `<label>` ที่เห็นได้ · error ผูก `aria-describedby` · ใช้ `<button>` `<a>` `<table>` จริง · เป้ากด ≥ 24px · ไม่มี dark mode
- คีย์บอร์ดล้วน: Tab/Enter ไล่ช่อง · `Ctrl+Enter` = บันทึก · `Esc` = ล้างแถวที่กำลังกรอก (สเปก §3.1)
- ปุ่มบันทึกกันกดซ้ำ (disable ระหว่างส่ง + idempotency key)

## เทสต์

- vitest + Testing Library (jsdom) ใน apps/web — ทดสอบพฤติกรรม: ลำดับ Tab ของฟอร์ม · payload ที่ส่ง · การแสดงเงิน · สถานะ error
- ทั้งแอป: `fakeApi({ "GET /api/me": () => json(makeMe("staff")) , … })` + `renderApp("/path")` จาก `src/test/app.ts`
- e2e: `WEB_PORT=… E2E_EMAIL=… E2E_PASSWORD=… pnpm --filter @ong/web e2e` (Playwright + axe ทั้งธีมสว่างและมืด · ไม่อยู่ใน `make check`)
- เทสต์ใช้ i18n ตัวจริง (ข้อความไทย) — query ด้วยข้อความไทยได้เหมือนเดิม
- `make check` เขียว

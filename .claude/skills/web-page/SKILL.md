---
name: web-page
description: สร้างหรือแก้หน้าใน apps/web (Vite + React + TanStack Router/Query + Tailwind 4 + shadcn/ui) ของร้านทอง — เงินเป็น string จาก API ห้ามคำนวณเงินใน browser ฟอร์ม Siam ID คีย์บอร์ดล้วน ใช้ทุกครั้งที่แตะ apps/web
---

# web-page

## โครง

- route แบบ file-based ใน `apps/web/src/routes/` (TanStack Router plugin generate `routeTree.gen.ts` — commit ไฟล์ที่ generate) · server state ผ่าน TanStack Query
- ทุกหน้าหลัง login อยู่ใต้ `_app.tsx` (guard + shell ของ dashboard-01) — route ทั้งหมดใน spec §3 **มีไฟล์แล้ว** เป็น stub (`component: PagePlaceholder`) → งานหน้า = แทน `component` ในไฟล์เดิม ไม่สร้าง route ใหม่ (routeTree ไม่ชนกัน)
- ชื่อหน้า: `staticData: { title, crumbs? }` ของ route → หัวหน้า breadcrumb และ `document.title` ใช้ค่านี้ · หัวเรื่องในเนื้อหาใช้ `<PageHeader description? actions? />` (h1 เดียวของหน้า ชื่อมาจาก staticData)
- ไฟล์เทสต์ห้ามอยู่ใน `src/routes/` (plugin จะนับเป็น route) — วางข้าง component หรือใน `src/test/`
- API origin เดียวกับ SPA (`/api/...`, cookie session ของ better-auth) · dev: vite proxy `/api` → `http://localhost:${API_PORT:-8787}` · หลายชุดพร้อมกัน: `WEB_PORT=5181 API_PORT=8791 make dev`
- สัญญา API: `../Work_2026-09-27/05-spec-vite-tanstack.md` §5 และโค้ดจริงใน `apps/api/src/routes/*.ts`

## data layer (`src/lib/`)

- `apiFetch(path, { json | form, schema?, signal })` — same-origin + `credentials: "same-origin"` · error = `ApiError {status, error, field?, body}` (status 0 = ติดต่อไม่ได้) · ใส่ `schema` (zod) ตรวจคำตอบที่ขอบ API · เงินใน schema ใช้ `decimalString`
- query options ใช้ `queryOptions()` ของ TanStack Query v5 ต่อ endpoint (ดู `meQueryOptions` / `goldPriceTodayQueryOptions` ใน `queries.ts`) · loader: `context.queryClient.ensureQueryData(x)` · component: `useQuery(x)` / `useSuspenseQuery(x)`
- ผู้ใช้ปัจจุบัน: `useMe()` (role · branch · branches) — ห้ามอ่าน me จาก route context (ไม่อัปเดตหลังสลับสาขา)
- 401 จาก query/mutation ใดก็ได้ → ตัวดักกลางใน `router.tsx` พาไป `/login?redirect=…` เอง · ยกเว้นตั้ง `meta: { handlesUnauthorized: true }`
- error ใต้ช่อง: `ApiError.field` → `<FieldError id=…>` + `aria-describedby` ที่ input · ข้อความรวม: `errorMessage(e)`
- สลับสาขาแล้ว invalidate ทุก query — query key ไม่ต้องใส่ branch id

## shadcn/ui

- style new-york · สี neutral · Tailwind 4 · component อยู่ `src/components/ui/` · เพิ่มด้วย `pnpm dlx shadcn@latest add <ชื่อ>` ใน `apps/web` (แล้ว `pnpm exec prettier --write` ไฟล์ใหม่) · MCP `shadcn` ใน `.mcp.json` ใช้ค้น registry
- component ใน `ui/` แก้แล้วบางตัว — **ห้าม `add --overwrite`**: `sidebar` (SidebarInset เป็น `<div>`, ป้ายไทย, skeleton ไม่สุ่ม) · `input` (พื้นทึบ `bg-background`) · `breadcrumb` (หน้าปัจจุบันไม่ใช่ role=link, ป้ายไทย) · `sonner` (ไม่ใช้ next-themes) · `sheet` (ป้ายไทย)
- ไอคอน `lucide-react` ชุดเดียว · ไอคอนประดับใส่ `aria-hidden="true"` · ปุ่มไอคอนล้วนต้องมี `aria-label` หรือ `sr-only`
- block ที่ใช้: `dashboard-01` (app-sidebar · nav-main · nav-user · site-header) · `login-04` (login-form) — ส่วน demo ถูกลบแล้ว
- ตาราง: `<DataTable columns data caption page hasMore onPageChange onRowActivate? isLoading?>` (`src/components/data-table.tsx`) — TanStack Table · แบ่งหน้าฝั่งเซิร์ฟเวอร์ด้วย `page` + `has_more` (ไม่มียอดรวมแถว) · คอลัมน์เงินใส่ `meta: { numeric: true }` · แถวกด Enter/คลิกได้เมื่อส่ง `onRowActivate` (↑/↓ ย้ายแถว)

## เงินและตัวเลข

- เงิน/น้ำหนักเก็บและส่งเป็น **string** เสมอ · **ห้ามคำนวณเงินใน browser** — ยอดรวม ราคา/กรัม คงเหลือ ฯลฯ มาจาก API (`/buy/quote`, `/gold-price/quote`)
- แสดงผลด้วย `src/lib/format.ts` เท่านั้น: `formatMoney` (2) · `formatWeight` (3) · `formatInteger` (ราคาทองรูปพรรณ 0) · `formatThaiDate` / `formatThaiDateTime` (พ.ศ.) — รับข้อความทศนิยมตรง ๆ ไม่ผ่าน `Number` · คู่กับ class `tabular-nums`
- เลขบัตรแสดงเต็มเฉพาะหน้าลูกค้าเดี่ยว · ที่อื่นใช้ `national_id_masked` จาก API

## ฟอร์มลูกค้า — Siam ID (CLAUDE.md กฎ 6)

- 11 ช่องเรียงตาม `../Work_2026-09-27/03-customer-member.md` **ห้ามสลับ** · ลำดับ DOM = ลำดับ Tab
- ใน 11 ช่องใช้แค่ shadcn `Input` / `Textarea` — **ห้าม `Select` · `Calendar` · `DatePicker` · Combobox** (ป๊อปอัปแย่งโฟกัสจาก Siam ID)
- element อื่นที่รับ focus ได้ระหว่างช่อง (ปุ่ม ลิงก์ โซนวางรูป) → `tabIndex={-1}` · ช่องวันที่ `<input type="text">` ห้าม date picker / input mask
- `autoComplete="off"` · Enter ไม่ submit (submit ด้วยปุ่มหรือ `Ctrl+Enter`) · format หลัง blur เท่านั้น
- รูป: โซน `onPaste` (`clipboardData.files[0]`) + `<input type="file" accept="image/*">` + preview · ส่ง multipart (`apiFetch(path, { form })`)

## UX / a11y (WCAG 2.2 AA)

- ภาษาไทยทั้งหมด · ฟอนต์ Sarabun (`/fonts`) · การ์ด/ตาราง/ฟอร์มเงินพื้นทึบ (`bg-card` / `bg-background` ห้ามโปร่ง) · `:focus-visible` เส้นน้ำเงิน 2px มาจาก `styles.css` อยู่แล้ว (แถวในกล่อง overflow ใส่ class `focus-inset`)
- ทุก input มี `<label>` ที่เห็นได้ · error ผูก `aria-describedby` · ใช้ `<button>` `<a>` `<table>` จริง · เป้ากด ≥ 24px · ไม่มี dark mode
- คีย์บอร์ดล้วน: Tab/Enter ไล่ช่อง · `Ctrl+Enter` = บันทึก · `Esc` = ล้างแถวที่กำลังกรอก (สเปก §3.1)
- ปุ่มบันทึกกันกดซ้ำ (disable ระหว่างส่ง + idempotency key)

## เทสต์

- vitest + Testing Library (jsdom) ใน apps/web — ทดสอบพฤติกรรม: ลำดับ Tab ของฟอร์ม · payload ที่ส่ง · การแสดงเงิน · สถานะ error
- ทั้งแอป: `fakeApi({ "GET /api/me": () => json(makeMe("staff")) , … })` + `renderApp("/path")` จาก `src/test/app.ts`
- e2e: `WEB_PORT=… E2E_EMAIL=… E2E_PASSWORD=… pnpm --filter @ong/web e2e` (Playwright + axe · ไม่อยู่ใน `make check`)
- `make check` เขียว

---
name: web-page
description: สร้างหรือแก้หน้าใน apps/web (Vite + React + TanStack Router/Query + Tailwind 4) ของร้านทอง — เงินเป็น string จาก API ห้ามคำนวณเงินใน browser ฟอร์ม Siam ID คีย์บอร์ดล้วน ใช้ทุกครั้งที่แตะ apps/web
---

# web-page

## โครง

- route แบบ file-based ใน `apps/web/src/routes/` (TanStack Router plugin generate `routeTree.gen.ts` — commit ไฟล์ที่ generate) · server state ผ่าน TanStack Query
- API origin เดียวกับ SPA (`/api/...`, cookie session ของ better-auth) · dev: vite proxy `/api` → `http://localhost:8787`
- error จาก API รูป `{error, field?}` → แสดงใต้ช่องที่ `field` ชี้ · 401 → ไป `/login`
- สัญญา API: `../Work_2026-09-27/05-spec-vite-tanstack.md` §5 และโค้ดจริงใน `apps/api/src/routes/*.ts`

## เงินและตัวเลข

- เงิน/น้ำหนักเก็บและส่งเป็น **string** เสมอ · **ห้ามคำนวณเงินใน browser** — ยอดรวม ราคา/กรัม คงเหลือ ฯลฯ มาจาก API (`/buy/quote`, `/gold-price/quote`)
- แสดงผล: `Intl.NumberFormat('th-TH', { minimumFractionDigits: 2 })` (น้ำหนัก 3 ตำแหน่ง) · CSS `tabular-nums`
- เลขบัตรแสดงเต็มเฉพาะหน้าลูกค้าเดี่ยว · ที่อื่นใช้ `national_id_masked` จาก API

## ฟอร์มลูกค้า — Siam ID (CLAUDE.md กฎ 6)

- 11 ช่องเรียงตาม `../Work_2026-09-27/03-customer-member.md` **ห้ามสลับ** · ลำดับ DOM = ลำดับ Tab
- element อื่นที่รับ focus ได้ระหว่างช่อง → `tabIndex={-1}` · ช่องวันที่ `<input type="text">` ห้าม date picker / input mask
- `autoComplete="off"` · Enter ไม่ submit (submit ด้วยปุ่มหรือ `Ctrl+Enter`) · format หลัง blur เท่านั้น
- รูป: โซน `onPaste` (`clipboardData.files[0]`) + `<input type="file" accept="image/*">` + preview · ส่ง multipart

## UX

- ภาษาไทยทั้งหมด · ฟอนต์ Sarabun (`/fonts`) · การ์ด/ตาราง/ฟอร์มเงินพื้นทึบ · focus ring ชัด
- คีย์บอร์ดล้วน: Tab/Enter ไล่ช่อง · `Ctrl+Enter` = บันทึก · `Esc` = ล้างแถวที่กำลังกรอก (สเปก §3.1)
- ปุ่มบันทึกกันกดซ้ำ (disable ระหว่างส่ง + idempotency key)

## เทสต์

- vitest + Testing Library (jsdom) ใน apps/web — ลำดับ Tab ของฟอร์ม · payload ที่ส่ง · การแสดงเงิน · สถานะ error
- `make check` เขียว

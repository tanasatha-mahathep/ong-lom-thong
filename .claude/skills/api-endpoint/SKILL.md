---
name: api-endpoint
description: เพิ่มหรือแก้ endpoint ใน apps/api (Hono) ของร้านทอง — โครง route/service, สาขา fail-closed, เงินเป็น string, audit, ไฟล์ใน bucket, เทสต์กับ Postgres จริง ใช้ทุกครั้งที่แตะ apps/api/src/routes หรือ services
---

# api-endpoint

อ่านตัวอย่างจริงก่อนเขียน: `apps/api/src/routes/customers.ts` + `services/customers.ts` + `routes/customers.test.ts` (ครบทุกแบบแผนข้างล่าง)

## โครง

- `routes/<name>.ts` = HTTP (parse · validate · status code) · `services/<name>.ts` = DB/ตรรกะ · mount ใน `src/app.ts` ใต้ `/api`
- `requireSession` ทุก route · role ด้วย `requireRole(...)` (403)
- ข้อมูลของสาขา: อ่านกรองด้วย `forUser(db, viewer)` · เขียนใช้ `currentBranch(viewer, readable)` (null = ปฏิเสธ) · ข้อมูลใช้ร่วมทั้งร้าน: `requireAnyBranch`
- **fail-closed**: resource ที่อ่านไม่ได้ = 404 (ไม่บอกว่ามีอยู่) · list = กรองออก/ว่าง · ห้าม fallback เป็น "ทุกสาขา" · uuid ผิดรูป = 404
- validate ด้วย zod `safeParse` → 400 `apiError(message, field)` ข้อความภาษาไทย

## เงินและเวลา

- เงิน/น้ำหนัก **รับ-ส่งเป็น string** (JSON number = 400) · คำนวณผ่าน `@ong/core` (decimal.js) เท่านั้น · ห้าม `Number()`/`parseFloat`/float กับเงิน · **ห้ามมีสูตรที่สองใน api**
- ปัดเศษ: เงิน HALF_UP 2 · น้ำหนัก 3 · ทองรูปพรรณ HALF_UP 0 · ต้นทุน/กรัม FLOOR
- "วันนี้" = `businessDate(c.var.now())` (เวลาไทย) · ใช้ `c.var.now()` ไม่ใช่ `new Date()` เพื่อให้เทสต์ตั้งนาฬิกาได้

## เขียนข้อมูล

- หลายตาราง = `db.transaction` เดียว · unique violation (23505) → 409 ที่อ่านรู้เรื่อง
- audit (R12): `audit_log` ในทรานแซกชันเดียวกัน · เลขบัตรในนั้นต้องมาสก์ (`maskNationalId`)
- เลขบัตรเต็มส่งเฉพาะ `GET /customers/:id` (และในไฟล์ PDF) · ที่อื่นมาสก์
- ไฟล์: `c.var.storage` (put/get เท่านั้น ไม่มี delete · ไม่เขียนทับ) · เสิร์ฟผ่าน api `Cache-Control: no-store` + `X-Content-Type-Options: nosniff` · ไม่มี public URL
- CSRF: `sameOriginOnly` ครอบ `/api` แล้ว

## เทสต์ (บังคับทุก endpoint)

- `src/routes/<name>.test.ts` ใช้ `startTestApp()` จาก `src/test/harness.ts` (DB ใหม่ต่อไฟล์ · migrate + seed สาขา 00000/00001/00002 + โลหะ 4 ชนิด) · `describe.skipIf(!available)`
- ต้องมี: 401 ไม่ login · 403 role · **scoping ข้ามสาขา** (ผู้ใช้อีกสาขาได้ว่าง/404) · สาขาถูกปิด · validation ชี้ field · CSRF origin อื่น = 403 · audit
- ข้อมูลสมมติเท่านั้น — เลขบัตรที่ checksum ถูกแต่ไม่ใช่ของจริง
- ลองทำให้โค้ดพังหนึ่งจุด (ถอดตัวกันสิทธิ์) ดูว่าเทสต์ fail จริง แล้วคืนค่า
- `make check` เขียวทั้งหมด

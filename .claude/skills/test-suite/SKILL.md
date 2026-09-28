---
name: test-suite
description: ชั้นเทสต์ทั้งหมดของ repo ร้านทอง — unit (packages/core) · coverage gate โมดูลเงิน · integration (apps/api + Postgres จริง) · db-verify (migration) · smoke (image ที่ Railway build) · e2e (Playwright tests/e2e) · PDF golden (Gotenberg ฟอนต์ไทย) · TestSprite ใช้ทุกครั้งที่เขียน แก้ หรือรันเทสต์ หรือเพิ่มชั้นเทสต์ใหม่
---

# test-suite

## ชั้นเทสต์ (เร็ว → ช้า)

| ชั้น          | อยู่ที่                                                          | รัน                  | ต้องมี                         |
| ------------- | ---------------------------------------------------------------- | -------------------- | ------------------------------ |
| unit          | `packages/*/src/**/*.test.ts` (vitest)                           | `pnpm test`          | —                              |
| coverage เงิน | root `vitest.config.ts` → `coverage.thresholds` ราย file         | `pnpm test:coverage` | —                              |
| integration   | `apps/api/src/**/*.test.ts` + `src/test/harness.ts`              | `pnpm test`          | Postgres (`TEST_DATABASE_URL`) |
| db-verify     | `scripts/ci/db-verify.sh`                                        | `make db-verify`     | Postgres                       |
| smoke (image) | `scripts/ci/image-smoke.sh`                                      | `make smoke`         | Docker                         |
| e2e           | `tests/e2e` (Playwright projects `smoke` · `api` · `pdf` · `ui`) | `make e2e`           | Docker                         |
| TestSprite    | `tests/testsprite/` (ดูท้ายไฟล์)                                 | ดู README ในนั้น     | API key ของผู้ใช้ (ไม่ commit) |

integration ไม่เจอ Postgres = ข้าม (บนเครื่อง dev) แต่ใน CI (`CI=true`) = fail — อย่าเปลี่ยนพฤติกรรมนี้

## กฎของทุกชั้น

- **เงิน/น้ำหนักเทียบเป็น string** (`expect(body.total).toBe("12345.00")`) หรือ `Decimal.eq` — ห้าม `toBeCloseTo` ห้ามแปลงเป็น number
- **เวลา**: ตั้งนาฬิกาผ่าน `startTestApp({ now })` · วันทำการคือเวลาไทย · ห้ามพึ่งนาฬิกาเครื่อง · ห้าม `sleep` — poll พร้อม timeout
- **ข้อมูลสมมติเท่านั้น**: ชื่อขึ้นต้น "ทดสอบ" · เลขบัตร 13 หลักที่ checksum ถูกแต่สร้างขึ้นเอง (ใช้ตัวช่วยใน `@ong/core`) · ห้ามคัดลอกจากใบจริง/staging/production
- **สาขา fail-closed**: ทุก endpoint มีเทสต์ข้ามสาขา — ผู้ใช้อีกสาขาได้ 404/ว่าง ไม่ใช่ข้อมูลทุกสาขา
- **มาสก์เลขบัตร**: response ที่ไม่ใช่ `GET /customers/:id` ต้องไม่มีเลข 13 หลักติดกัน — ตรวจด้วย regex บน JSON ทั้งก้อน
- **อิสระต่อกัน**: integration ได้ DB ใหม่ต่อไฟล์ (ชื่อสุ่ม — รันขนานกับเอเจนต์อื่นได้) · e2e สร้างข้อมูลของตัวเองด้วย suffix สุ่ม ห้ามพึ่งลำดับเทสต์
- **negative control**: เขียนเทสต์กันสิทธิ์/กันเงินเสร็จ ให้ลองถอดตัวกันในโค้ดหนึ่งจุด ดูว่า fail จริง แล้วคืนค่า
- **flake**: ในเครื่องไม่ retry · CI ให้ retry 1 ครั้งเฉพาะ e2e พร้อมเก็บ trace — เทสต์ที่ต้อง retry ถึงผ่านคือบั๊กที่ต้องแก้
- เทสต์เจอบั๊กในโค้ดจริง → **อย่าแก้โค้ดที่ถูกเทสต์เอง** (session อื่นเป็นเจ้าของ) · รายงานพร้อมชื่อเทสต์ที่ fail และสถานการณ์

## ทรัพยากรในเครื่อง (มีหลาย session ใช้เครื่องเดียวกัน)

- **ห้าม bind port** 5173 · 8787 · 9000 · 9100 · 3000 · 5432 · 3306 — session อื่นใช้อยู่
- Postgres สำหรับ unit/integration/db-verify: ใช้ container ที่รันอยู่ `postgres://ong:ong@localhost:5432/postgres` (สร้าง database ชื่อสุ่มแล้วลบทิ้ง)
- smoke: container ชื่อขึ้นต้น `ong-smoke-` · api ที่ host port `18787`
- e2e: compose project `ong-e2e` · api `28787` · gotenberg `23000` · ที่เหลือไม่เปิด port ออก host
- ทุก script ต้อง `trap` ลบ container/network/volume ของตัวเองเสมอ แม้ fail
- S3 ใน e2e = RustFS ปัก digest เดียวกับ `docker-compose.yml` (image `minio/minio` ถูกถอดจาก Docker Hub แล้ว) · image ทุกตัวปัก digest

## PDF golden (Gotenberg)

- ยิง `POST /forms/chromium/convert/html` (basic auth) ด้วย HTML fixture ภาษาไทย
- ตรวจ: ขึ้นต้น `%PDF-` · MediaBox A4 595.28×841.89 pt (±0.5) · ดึงข้อความไทยออกมาได้ตรง · ฟอนต์ Sarabun ถูก embed (ไม่ใช่ fallback)
- ไม่ทำ pixel diff (Chromium เปลี่ยนรุ่นแล้วพังโดยไม่มีบั๊ก) — PDF ใบจริงเป็นเอกสารภาษี: เปลี่ยน image Gotenberg ต้องผ่านชุดนี้ก่อน

## TestSprite

- ใช้กับ stack e2e ในเครื่องหรือ environment `testing` ที่มีแต่ข้อมูลสมมติ — **ห้ามชี้ไปที่ production หรือ staging ที่มีข้อมูลจริง** (ข้อมูล/โค้ดถูกส่งไป cloud ของ TestSprite)
- เทสต์ที่ TestSprite สร้าง = ข้อเสนอ: คนตรวจก่อน commit · ห้ามเป็น gate บังคับ
- API key อยู่ใน env ของผู้ใช้หรือ repo secret เท่านั้น — ห้าม commit

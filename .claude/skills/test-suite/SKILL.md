---
name: test-suite
description: ชั้นเทสต์ทั้งหมดของ repo ร้านทอง — unit (packages/core) · coverage gate โมดูลเงิน · integration (apps/api + Postgres จริง) · db-verify (migration) · smoke (image ที่ Railway build) · e2e (Playwright tests/e2e) · PDF golden (Gotenberg ฟอนต์ไทย) · TestSprite ใช้ทุกครั้งที่เขียน แก้ หรือรันเทสต์ หรือเพิ่มชั้นเทสต์ใหม่
---

# test-suite

## ชั้นเทสต์ (เร็ว → ช้า)

| ชั้น               | อยู่ที่                                                                                                                                                                                 | รัน                                          | ต้องมี                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------- |
| unit               | `packages/*/src/**/*.test.ts` (vitest)                                                                                                                                                  | `make test`                                  | —                                         |
| coverage เงิน/ภาษี | root `vitest.config.ts` — ทุกไฟล์ runtime ใน `packages/core/src` 100% ต่อไฟล์ · ข้อยกเว้นเป็นจำนวน branch ที่วัดได้ใน `MEASURED` · วัดจากเทสต์หน่วยของ core เท่านั้น (`--project core`) | `make test-coverage`                         | —                                         |
| integration        | `apps/api/src/**/*.test.ts` + `src/test/harness.ts` · ตัวช่วย `src/test/{synthetic,pii,assertions,routes}.ts`                                                                           | `make test`                                  | Postgres (`TEST_DATABASE_URL`)            |
| สัญญา API          | `apps/api/src/app.contract.test.ts` — อ่าน route จาก router ของ Hono เอง · allowlist ที่มีคอมเมนต์                                                                                      | `make test`                                  | Postgres                                  |
| db-verify          | `scripts/ci/db-verify.sh` (+ `db-verify-selftest.sh`)                                                                                                                                   | `make db-verify` · `make db-verify-test`     | Postgres                                  |
| smoke (image)      | `scripts/ci/image-smoke.sh`                                                                                                                                                             | `make smoke`                                 | Docker                                    |
| e2e                | `tests/e2e` — Playwright projects `setup` · `smoke` (อ่านอย่างเดียว · ใช้หลัง deploy ด้วย) · `api` · `pdf` · `ui`                                                                       | `make e2e-up` → `make e2e` → `make e2e-down` | Docker                                    |
| TestSprite         | `tests/testsprite/` (ดูท้ายไฟล์)                                                                                                                                                        | `make testsprite-probe URL=…`                | Python 3 · API key ของผู้ใช้ (ไม่ commit) |

- เทสต์ที่ยึดบั๊กไว้: `it.fails("F<n> …")` (vitest) / `test.fail` + `@known-issue` (Playwright) — ชื่อต้องมีรหัส finding · คนแก้บั๊กเปลี่ยนเป็นเทสต์ปกติใน PR เดียวกัน
- ห้ามใช้คอมเมนต์ `v8 ignore` / `istanbul ignore` / `c8 ignore` ใน `packages/core` (eslint บังคับ)

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
- e2e จำลอง client หลายเครื่องด้วย `X-Real-IP` (198.18.0.0/15) — better-auth อ่าน IP จาก header นี้เท่านั้น (login จำกัด 20 ครั้ง/นาที/IP)
- Docker VM มีดิสก์จำกัด (เคยเต็มจน Postgres ร่วมล่ม) — build image ทีละตัว · ลบ image/build cache ของตัวเองเมื่อเสร็จ · ห้าม prune volume
- ทุก script ต้อง `trap` ลบ container/network/volume ของตัวเองเสมอ แม้ fail
- S3 ใน e2e = RustFS ปัก digest เดียวกับ `docker-compose.yml` (image `minio/minio` ถูกถอดจาก Docker Hub แล้ว) · image ทุกตัวปัก digest

## PDF golden (Gotenberg)

- ยิง `POST /forms/chromium/convert/html` (basic auth) ด้วย HTML fixture ภาษาไทย
- ตรวจ: ขึ้นต้น `%PDF-` · MediaBox A4 595.28×841.89 pt (±0.5) · ดึงข้อความไทยออกมาได้ตรง · ฟอนต์ Sarabun ถูก embed (ไม่ใช่ fallback)
- ไม่ทำ pixel diff (Chromium เปลี่ยนรุ่นแล้วพังโดยไม่มีบั๊ก) — PDF ใบจริงเป็นเอกสารภาษี: เปลี่ยน image Gotenberg ต้องผ่านชุดนี้ก่อน

## TestSprite

- CLI (`@testsprite/testsprite-cli` ปักเวอร์ชันตรง) ยิงได้เฉพาะ URL สาธารณะ — เทสต์ backend รันบน cloud ที่สหรัฐฯ และเข้า localhost ไม่ได้ (tunnel ของ CLI ใช้ได้แค่เทสต์ frontend) → ในเครื่องใช้ `make testsprite-probe URL=http://localhost:<port>` (pytest ของเราเอง ไฟล์เดียวกัน)
- เป้าหมาย: environment `testing` ที่มีแต่ข้อมูลสมมติ · `staging` ได้เฉพาะ probe อ่านอย่างเดียวและไม่ใช่ช่วง UAT · **ห้าม production เด็ดขาด**
- advisory เท่านั้น (`testsprite.yml` ทุกคืน · ห้ามย้ายเข้า `ci.yml`) · ห้ามติดตั้ง GitHub App ของ TestSprite (เปิด "Blocking PRs" เป็นค่าเริ่มต้น)
- API key อยู่ใน repo secret `TESTSPRITE_API_KEY` หรือ env ของผู้ใช้เท่านั้น — ห้าม commit · MCP server ตั้งระดับผู้ใช้เท่านั้น ห้ามเพิ่มลง `.mcp.json`

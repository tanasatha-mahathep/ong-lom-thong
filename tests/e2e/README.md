# tests/e2e — Playwright บน stack จริง

ชั้นบนสุดของ test pyramid: ยิงใส่ **image ตัวเดียวกับที่ Railway deploy** (`apps/api/Dockerfile` — web + REST origin เดียว)
พร้อม Postgres 18 · S3 (RustFS) · Gotenberg + Sarabun จริง — ไม่ mock อะไรเลย ชั้นล่างกว่านี้ (unit · integration) อยู่ในแต่ละแพ็กเกจ

| project | ตรวจอะไร                                                                                                                                                                                                                                                                                                                                                                                                                                       | เขียนข้อมูล | รันที่ไหน                                      |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------- |
| `setup` | สร้างบัญชีของรอบนี้ผ่าน `node dist/create-user.js` ใน container (ปิด sign-up) — เฉพาะ stack ในเครื่อง                                                                                                                                                                                                                                                                                                                                          | ✓           | ก่อน `api` และ `ui`                            |
| `smoke` | health · SPA shell + assets · `/api` ที่ไม่มี = JSON 404 · asset ที่ไม่มี = 404 · 401 ไม่มี session · 403 เขียนจาก origin อื่น · path traversal · ไม่มี stack trace · security header (CSP · HSTS · COOP …) + cache ของ shell/asset/api                                                                                                                                                                                                        | **ไม่เลย**  | ring 1 + **หลัง Railway deploy** (ring 2)      |
| `api`   | journey ต่อ role ผ่าน cookie/CSRF/S3 จริง: ลูกค้า (มาสก์ · เลขเต็ม · รูป private) · ราคาทอง (R8) · admin เฉพาะ admin · **ซื้อเข้า**: quote → บันทึก (idempotent) → อ่านกลับเป็น string → สาขาอื่น 404 · **PDF ใบรับซื้อ (R15 · กฎ 5)**: สร้างเบื้องหลัง → ดาวน์โหลดผ่าน api (no-store · nosniff) → A4 · Sarabun · ตัวเลขตรงกับ api · สำเนาบัตรแยกไฟล์ (accounting/admin) · ยกเลิก = ไฟล์ใหม่ ฉบับเดิมไม่เปลี่ยน · access log ไม่มีข้อมูลลูกค้า | ✓           | stack ในเครื่อง หรือ `E2E_ALLOW_WRITES=1`      |
| `pdf`   | Gotenberg ตรง ๆ ด้วยฟอนต์ Sarabun **ที่ติดตั้งใน image** (ไม่ส่งไฟล์ฟอนต์): ISO 32000 header/trailer · A4 ±0.5 pt · ข้อความไทยทุกบรรทัดตรงทุกวรรณยุกต์ (/ActualText) · ฝังแค่ Sarabun (FontFile2) + negative control · basic auth                                                                                                                                                                                                              | ไม่         | stack ในเครื่อง (Gotenberg บน Railway private) |
| `ui`    | Chromium กับ build จริง: `/` → `/login` · login ด้วยคีย์บอร์ด → หน้าแรกแสดงราคา R8 จากเซิร์ฟเวอร์ · `lang="th"` · Sarabun โหลดจริง · console เงียบ · ไม่มี CSP violation · axe-core WCAG 2.0/2.1/2.2 A+AA ทั้งสองหน้า                                                                                                                                                                                                                          | ✓ (login)   | ring 1 (stack ในเครื่อง)                       |

## รัน

```bash
pnpm --filter @ong/e2e stack:up     # = make e2e-up   · build image จาก working tree · secrets ใหม่ · รอจน healthy (~40 วินาที)
pnpm --filter @ong/e2e e2e          # = make e2e      · ทุก project · เลือกได้: … e2e --project=api
pnpm --filter @ong/e2e stack:down   # = make e2e-down · SIGTERM api (ต้อง exit 0) · ลบ container · network · volume · secrets
pnpm --filter @ong/e2e report       # เปิด HTML report (trace ของเทสต์ที่ fail อยู่ในนั้น)
```

ครั้งแรกในเครื่อง: `pnpm --filter @ong/e2e exec playwright install chromium`

### เป้าหมาย (env)

| ตัวแปร                            | ค่าเริ่มต้น                          | ใช้ทำอะไร                                                                                        |
| --------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `E2E_BASE_URL`                    | `http://localhost:28787`             | ชี้ที่อื่น (เช่น URL ของ Railway) = ไม่ใช่ stack ในเครื่อง → `setup` ข้าม · `api` ปฏิเสธที่จะรัน |
| `E2E_ALLOW_WRITES`                | —                                    | `1` = environment นั้นทิ้งได้ ให้ `api` เขียน (ต้องส่งบัญชีมาทาง `E2E_ACCOUNTS_FILE`)            |
| `E2E_ACCOUNTS_FILE`               | `$E2E_STATE_DIR/accounts.json`       | บัญชีรูปแบบเดียวกับที่ `setup` เขียน                                                             |
| `E2E_GOTENBERG_URL` · `_PASSWORD` | `http://localhost:23000` · จาก stack | project `pdf`                                                                                    |
| `E2E_STATE_DIR`                   | `$TMPDIR/ong-e2e`                    | secrets + บัญชีของ stack — **นอก repo** ไม่หลุดเข้า git หรือ docker build context                |
| `API_IMAGE`                       | — (build จาก working tree)           | CI: ใช้ image ที่ job `image` build ไว้ (`docker load`) และไม่ build ซ้ำ                         |
| `E2E_KEEP_ON_FAILURE`             | —                                    | `1` = stack ขึ้นไม่ครบก็ไม่ลบ (ไว้ดู `stack.sh logs`)                                            |

deploy-smoke (ring 2): `E2E_BASE_URL=https://<env>.up.railway.app pnpm --filter @ong/e2e e2e --project=smoke` — อ่านอย่างเดียว

## stack (`stack/compose.yml` · compose project `ong-e2e`)

`postgres` → `migrate` (one-shot `node dist/migrate.js && node dist/seed.js` = pre-deploy ของ Railway) ·
`s3` (RustFS) → `s3-init` (สร้าง bucket private) · `gotenberg` (build `services/gotenberg`) → `api` (NODE_ENV=production)
ทุกตัวมี healthcheck · `docker compose up --wait` · image ปัก digest ทั้งหมด (สองตัวที่ build เองมาจาก Dockerfile ที่ปัก digest)
เปิดออก host เฉพาะ `127.0.0.1:28787` (api) และ `127.0.0.1:23000` (gotenberg) · `stack.sh logs|ps|exec` ส่งต่อให้ compose

## ข้อมูลทดสอบ

- **สมมติทั้งหมด** — ชื่อขึ้นต้น "ทดสอบ" · เลขบัตรจาก `syntheticNationalId()`: หลักตรวจสอบถูก (เลือกหลักที่ `isValidNationalId` ของ `@ong/core` ยอมรับ — ไม่มีสูตรที่สอง) แต่รหัสจังหวัด `00` ไม่มีจริง จึงไม่ใช่เลขของใคร
- ทุกอย่างติด `E2E_RUN_ID` (`yyMMddHHmm-xxxx`) — รันซ้ำบน stack เดิมไม่ชนกัน · เทสต์ไม่พึ่งลำดับกัน
- ทุก client ที่จำลอง (รวม browser ของ `ui`) มี cookie jar ของตัวเอง · ส่ง `Origin` แบบ browser บนเว็บนี้ · มี IP ของตัวเองใน `X-Real-IP` จาก `198.18.0.0/15` (RFC 2544) — api เชื่อ IP จาก header นี้อย่างเดียว (edge ของ Railway เขียนทับทุก request) · ใน stack ไม่มี edge เทสต์จึงทำแทน ไม่งั้น production นับทุก sign-in รวมถังเดียว (20 ครั้ง/นาที)

### `pdf` กับเทสต์ PDF ของ `apps/api` (vitest · `TEST_GOTENBERG_URL`)

vitest ครอบ client ของ api: ฟอร์มที่ส่ง · timeout/error · ฟอนต์ที่ **ส่งเป็นไฟล์** (`BaseFont …+Sarabun-*`) · ไม่มี PDF/A · `/Title` · รูป · asset หาย = 409 · รหัสผ่านผิด = 401 · MediaBox ±2 pt
e2e `pdf` ไม่ทำซ้ำ แต่ครอบส่วนที่เหลือ: ฟอนต์ **ในตัว image** (สำรองของ `local("Sarabun …")` ในใบจริง) · ข้อความไทยอ่านกลับได้ครบผ่าน parser จริง · ไม่มีฟอนต์สำรอง (Noto Sans Thai) ปน · negative control · ไม่ส่งรหัส/ชื่อผู้ใช้ผิด = 401 · route อื่นปิด
ซ้ำกันโดยตั้งใจ (ถูก เพราะอ่านจาก PDF ที่ render อยู่แล้ว): `%PDF-`/`%%EOF` · MediaBox (ที่นี่เข้มกว่า ±0.5) · รหัสผ่านผิด = 401
ข้อเท็จจริงที่วัดได้ (Gotenberg 8.37.0 · HeadlessChrome 152): `%PDF-1.4` · MediaBox `[0 0 594.95996 841.91998]` · Producer `Skia/PDF m152` · `…+Sarabun-Regular/Bold` เป็น Type0/CIDFontType2 + FontFile2
**ข้อความไทยถูกเฉพาะผ่าน `/ActualText`**: Skia เขียน `<0000>` ใน /ToUnicode ให้ glyph ที่ font สลับรูป (วรรณยุกต์บนสระบน · ลิเกเจอร์ของ น้ำ · ป ปู่) แล้วห่อทั้ง cluster ด้วย `/ActualText` — reader ที่ไม่อ่าน ActualText (PDF.js/Firefox) ได้ `ซื\u0000อ` · `lib/pdf.ts` ใช้ ActualText เอง (ISO 32000-1 §14.9.4) และปักทั้งสองชั้นเป็น golden

## ที่ product แก้แล้ว (PR #61) — ตอนนี้เป็นเทสต์ปกติ

- `/api/<ไม่มี route>` ทุก method = JSON 404 `no-store` (เคยได้ SPA shell 200) · `/assets/<ไม่มี>` = 404 ไม่ใช่ HTML ไม่ cache
- security header ทุก response: CSP (`default-src 'self'` · `object-src 'none'` · `frame-ancestors 'none'` · `base-uri`/`form-action 'self'`) · `X-Frame-Options: DENY` · `nosniff` · `Referrer-Policy: strict-origin-when-cross-origin` · COOP `same-origin` · HSTS
  - **HSTS บน http://localhost**: แอปส่ง `Strict-Transport-Security: max-age=31536000` ทุก response แม้ผ่าน http — browser ไม่สนเมื่อได้มาทางที่ไม่ปลอดภัย (RFC 6797 §8.1) และใช้จริงบน HTTPS ของ Railway · เทสต์ตรวจ max-age ≥ 1 ปี (ค่าจริงลงใน annotation ของ report)
- cache: `/api/*` = `no-store` (route ที่ตั้งเองใช้ค่าของ route) · index.html ทุกทาง = `no-cache` · `/assets/*` = `public, max-age=31536000, immutable`
- sign-in: IP จาก `X-Real-IP` อย่างเดียว · 20 ครั้ง/นาที ต่อ IP → ครั้งที่ 21 = 429 (+ `X-Retry-After`) · สุ่ม `X-Forwarded-For` ทุกครั้งก็ไม่ได้รอบใหม่
- access log บรรทัดละ request ไม่มี query/เลขบัตร/cookie — `specs/api/access-log.spec.ts` อ่าน log จริงของ container
- SIGTERM: `stack.sh down` หยุด api ด้วย SIGTERM ก่อน (เหมือน Railway redeploy) และ fail ถ้า exit code ไม่ใช่ 0

### PDF ใบรับซื้อ (`specs/api/buy.spec.ts`)

stack ตั้ง `RECEIPT_WATERMARK` แบบ environment ที่ไม่ใช่ production — ทุกใบมีลายน้ำ "ตัวอย่าง — ระบบทดสอบ ไม่ใช่ใบรับซื้อจริง" (เทสต์ตรวจว่ามี)

- บันทึกบิล → `pdf_status: pending` ทันที (ไม่รอ Gotenberg) → poll จน `ready` → `GET /api/buy/:id/pdf`: `application/pdf` · `no-store` · `nosniff` · `inline; filename="<doc_no>.pdf"` · A4 ±0.5 pt · ฝังแค่ Sarabun · ข้อความมีเลขที่บิล · ชื่อผู้ขาย · เลขบัตรเต็ม (R13 ยกเว้น PDF) · น้ำหนัก/ราคา/ยอดชำระจาก string ของ api (ใส่คอมมาเท่านั้น) · ยอดตัวอักษร
- พิมพ์ซ้ำ = ไฟล์เดิม byte ต่อ byte · ไม่มี session 401 · สาขาอื่น 404 · ไม่มี route ลบ (404) · JSON ของบิลไม่มี URL/key ของ bucket
- สำเนาบัตร (ลูกค้ามีรูป) = ไฟล์แยก · staff 403 · accounting ได้
- ยกเลิก: staff 403 · ไม่มีเหตุผล 400 · manager 200 · ซ้ำ 409 → `void_pdf_status: ready` → ค่าเริ่มต้นได้ฉบับยกเลิก (`<doc_no>_void.pdf` · ตรา "ยกเลิก" + เหตุผล) · `?version=original` = ฉบับเดิม **byte ต่อ byte** · ยอดรวมในรายการไม่นับบิลนี้

## เขียนเทสต์เพิ่ม

- `smoke` ใช้ fixture `site` เท่านั้น (GET/HEAD + `foreignWrite`) — ห้ามเรียก `request.post` ตรง ๆ เพราะรันกับ production
- `api` ใช้ `signedIn("<บัญชี>")` / `anonymous()` จาก `lib/fixtures.ts` · error ตรวจด้วย `expectApiError` / `expectFieldError` (รูป `{error, field?}` · ไม่มี stack trace · ข้อความไทย)
- เงิน/น้ำหนักเทียบเป็น **string** เสมอ (`"67650.00"`) · วันทำการคือเวลาไทย · ห้าม `waitForTimeout` — ใช้ web-first assertion/`expect.poll`
- endpoint ใหม่ต้องมี: 401 · 403 role · ข้ามสาขา = 404/ว่าง · CSRF origin อื่น = 403 · validation ชี้ field
- เทสต์กันสิทธิ์/มาสก์: ลองถอดตัวกันใน product หนึ่งจุด (image แยก) ดูว่าเทสต์ fail จริง

## มาตรฐานที่ใช้

Playwright best practices (web-first assertions · isolation ต่อเทสต์ · project dependencies แทน globalSetup · trace เมื่อ fail) ·
WCAG 2.2 AA ผ่าน axe-core · OWASP ASVS 4.0.3 (V2.2 anti-automation · V3.4 cookie · V4 access control · V7.1 log ไม่มีข้อมูลอ่อนไหว · V7.4 error handling · V12.3 path traversal · V13 API · V14.4 headers) + OWASP Secure Headers Project · RFC 6797 (HSTS) ·
ISO 32000 (โครง PDF) + ISO 216 (A4) · Unicode UAX #15 (NFC) · ISO/IEC/IEEE 29119 (แยกระดับเทสต์ · test data · negative control) · RFC 2544/2606 (ที่อยู่/โดเมนสำหรับทดสอบ)

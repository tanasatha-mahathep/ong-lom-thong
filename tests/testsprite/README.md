# TestSprite — ชั้นเทสต์เสริม (advisory) · `@ong/testsprite`

backend probes แบบอ่านอย่างเดียวที่รันได้สองที่: **pytest ของเราเอง** (ในเครื่อง/กับ URL ใดก็ได้ ไม่มีอะไรออกนอก)
และ **cloud ของ TestSprite** ทุกคืนผ่าน `.github/workflows/testsprite.yml` — ผลเป็นคำเตือน ไม่ใช่ gate ของ PR หรือ promote

## ให้อะไรเพิ่ม · ทำอะไรไม่ได้

| ให้เพิ่ม                                                                                            | ทำไม่ได้ / ไม่ทำ                                                                                                                      |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| มองจากอินเทอร์เน็ตจริง (AWS สหรัฐฯ) นอก Railway — เจอปัญหา edge/TLS/header ที่เทสต์ในเครื่องไม่เห็น | **gate PR ไม่ได้** — CLI ปฏิเสธ localhost/IP ภายใน (exit 5) · tunnel (`--local`) ใช้ได้เฉพาะ frontend                                 |
| รันซ้ำทุกคืนกับ environment ที่ deploy แล้ว (drift หลัง deploy · config ของ Railway)                | ไม่แทน vitest · integration (Postgres จริง) · Playwright e2e — ชั้นพวกนั้นคือ gate                                                    |
| portal ให้คนที่ไม่ใช่ dev ดูผล/ประวัติ · AI เสนอเทสต์ใหม่ (เป็นแค่ข้อเสนอ)                          | เทสต์ที่ต้อง login ยังไม่ทำ (ระยะ 2 ด้านล่าง) · ไม่มีเทสต์เงิน/สาขาบน TestSprite                                                      |
|                                                                                                     | backend test รันเป็นสคริปต์ Python บน cloud — **สำเนาบน cloud คือของที่รันจริง** ไฟล์ใน repo เป็นต้นฉบับที่ `doctor` ใช้ตรวจว่าตรงกัน |

## กฎ (ห้ามละเมิด)

1. **ข้อมูลที่ส่งไป TestSprite ออกนอกประเทศ** — privacy policy (28 พ.ค. 2569) ระบุประมวลผลที่สหรัฐฯ (AWS) · ไม่ระบุระยะเก็บ · อ้าง SOC 2 (ขอรายงานได้ ไม่ระบุ type) ·
   ไม่มี ISO/IEC 27001 · ไม่มี DPA สาธารณะ · ไม่พูดเรื่องใช้ข้อมูลเทรนโมเดล (หน้าราคาอ้าง GPT-5.4 Mini / Claude Sonnet 4.6 แต่ไม่อยู่ในรายชื่อ subprocessor) → ถือว่าทุกอย่างที่ส่งไปเปิดเผยต่อบุคคลที่สาม
2. **ข้อมูลสมมติเท่านั้น** — ลูกค้าจริงมีข้อมูลอ่อนไหว (ศาสนา · รูปบัตร · เลขบัตร) ตาม PDPA ม.26 และการส่งออกนอกประเทศต้องเข้า ม.28–29 → ห้ามชี้ environment ที่มีข้อมูลจริง
3. **เป้าหมาย** — `testing` บน Railway (ยังไม่สร้าง) คือเป้าหมายระยะยาว · `staging` ได้เฉพาะ probe อ่านอย่างเดียว (project ชื่อ `…-staging-readonly-backend`) และ**ห้ามช่วง UAT** (เช่น อ. 29 ก.ย. 2569 — ลบ `TESTSPRITE_PROJECT_ID` ก่อน) · **production ห้ามเด็ดขาด**
   — `doctor` ปฏิเสธชื่อ/host ที่มี `prod` และ host ที่ไม่อยู่ใน `project.hosts` ของ `testsprite.json` (แก้ allow-list ต้องผ่าน PR)
4. ห้ามใส่ค่าลับในโค้ดเทสต์ · API key อยู่ใน repo secret `TESTSPRITE_API_KEY` หรือ env ของคนที่รันเท่านั้น (ห้าม `testsprite setup` บนเครื่องที่ใช้ร่วม — จะเขียน key ลง `~/.testsprite`)
5. **ห้ามติดตั้ง GitHub App ของ TestSprite** — ค่าเริ่มต้นเปิด _Run on Pull Requests_ · _Include Draft PRs_ · _Blocking PRs_ (merge gate นอก `ci.yml`) และขอสิทธิ์ `contents:write` `checks:write` `pull_requests:write` `statuses:write`
   ถ้ามีคนติดตั้งไปแล้ว: ปิด 3 toggle นั้นทันทีแล้วถอนการติดตั้ง
6. ห้ามใช้ official action `TestSprite/testsprite-action` — ค่าเริ่มต้น `cli-version: latest` · ติดตั้ง CLI แบบ `npm install -g` · action ซ้อนปักด้วย tag ที่ย้ายได้ (`@v4`) ขัดกฎปัก SHA ของ repo
7. เทสต์ที่ AI ของ TestSprite สร้าง (portal/MCP) = **ข้อเสนอ** — คนตรวจแล้ว commit ตามรูปแบบของ repo ก่อน · `doctor` ไม่ยอมรันถ้า project มีเทสต์ที่ไม่อยู่ใน `testsprite.json`

## โครง

```
backend/test_*.py      probes: requests + assert แบบ pytest — รันได้ทั้ง pytest ของเรา และเป็นสคริปต์บน TestSprite
backend/conftest.py    เฉพาะ pytest ของเรา (ไม่ sync): ตั้ง ONG_PROBE_RUNNER · known failure → xfail(strict)
testsprite.json        manifest: เทสต์ที่ sync · known failure · รูปแบบชื่อ project · host ที่อนุญาตต่อ environment
scripts/testsprite.js  ตัวห่อ CLI + guard: doctor · run · sync · classify     (ตรรกะล้วน scripts/lib.js + lib.test.js)
scripts/probe.sh       รัน probes ด้วย pytest ของเรา — venv .venv (gitignore) ติดตั้งแบบ --require-hashes
requirements.in/.txt   pytest + requests — lock พร้อม hash (pip-compile --generate-hashes)
```

รูปแบบไฟล์เทสต์ (ตาม `testsprite test scaffold --type backend` ของ CLI 0.13.0): TestSprite **รันไฟล์จากบนลงล่างและไม่ collect แบบ pytest**
เทสต์ที่ประกาศแต่ไม่ถูกเรียก = ผ่านแบบว่างเปล่า → ท้ายไฟล์ต้องเรียกเองภายใต้ `if os.environ.get("ONG_PROBE_RUNNER") != "pytest":`
และ base URL ต้องอยู่ในโค้ด (sandbox ของ backend ไม่ได้รับ `--target-url`) → ไฟล์ใน repo มีบรรทัด `BASE_URL = os.environ.get("ONG_BASE_URL", "").rstrip("/")`
หนึ่งบรรทัด ซึ่ง `sync` แทนด้วย URL จริงตอนอัปโหลด · sandbox มีแค่ stdlib + `requests` + `pytest` + `numpy` + `scipy`

## เทสต์ชุดแรก — backend probes (ไม่ต้อง login)

| ไฟล์                                | ตรวจ                                                                                                                                                                                 | สถานะ |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `test_health.py`                    | `/healthz` · `/api/healthz` = 200 JSON มีแค่ `{ok, time}`                                                                                                                            | sync  |
| `test_auth_required.py`             | route ข้อมูลใต้ `/api` (me · metals · gold-price · customers · buy · reports) ไม่มี session · cookie ปลอม · Bearer = 401 · คำขอเขียน origin เดียวกันหยุดที่ 401                      | sync  |
| `test_origin_guard.py`              | คำขอเขียน 12 แบบ (รวม `POST /api/buy` · `/api/buy/quote`) จาก origin อื่น / `null` / ต่อท้ายโดเมน / subdomain / scheme อื่น / ไม่มี Origin = 403 · positive control 401 · ไม่มี CORS | sync  |
| `test_malformed_ids.py`             | id/query ผิดรูปของลูกค้าและใบรับซื้อ (SQL · traversal · NUL · 2000 ตัว · ภาษาไทย · %-encoding เสีย · CRLF) ก่อน login = 401 เหมือนกันทุกตัว ไม่มี 5xx                                | sync  |
| `test_error_hygiene.py`             | error body ไม่มี stack trace · path ภายใน · ข้อความ DB · errno — ทุกคำขอที่ผิดโดยตั้งใจต้องไม่ 5xx                                                                                   | sync  |
| `test_security_headers.py`          | พิมพ์ header ที่สังเกตได้ลง log · ไม่บอกเวอร์ชัน · cookie (ถ้ามี) HttpOnly+SameSite(+Secure) · ไม่มี CORS `*`                                                                        | sync  |
| `test_unknown_api_route.py`         | path ที่ไม่มีใต้ `/api` = 404 JSON ทุก method · path ย่อยใต้ route ที่ต้อง login หยุดที่ 401 (ไม่มี oracle) — กันถดถอย F1                                                            | sync  |
| `test_security_headers_baseline.py` | nosniff · กัน framing · CSP ไม่ยอม inline/eval script + `object-src 'none'` · Referrer-Policy · COOP · `/api` no-store · HSTS (https) — กันถดถอย F2                                  | sync  |

ปลอดภัยกับ environment ที่ใช้ร่วม: GET/OPTIONS ล้วน ยกเว้นคำขอเขียนที่ถูกปฏิเสธก่อนถึง handler (origin อื่น หรือไม่มี session) หรือไปที่ path ที่ไม่มีอยู่ และ body ผิดรูปโดยตั้งใจ —
ต่อให้ guard ถดถอยก็เขียนอะไรไม่ได้ · **ไม่แตะ `/api/auth/sign-in/*` เลย** (ดู F3) · ~200 คำขอต่อรอบ · User-Agent `ong-probe/1 (read-only; tests/testsprite)` หาใน log ของ Railway ได้

**ผลที่พบ** (28 ก.ย. 2569 · build ของ `dev` และ image จาก `apps/api/Dockerfile`) — **แก้แล้วใน PR #61 (`cdab984`, 29 ก.ย.)** · probes ยืนยันกับ build ใหม่ในเครื่อง: 25 ผ่าน · 1 ข้าม (HSTS บน http)

- **F1** `GET /api/<ไม่มี>` เคยได้หน้า SPA 200 (POST ได้ 404 `text/plain`) → ตอนนี้ `app.all("/api/*")` ตอบ 404 JSON ทุก method · `test_unknown_api_route.py` กันถดถอย
- **F2** api เคยไม่ตั้ง security header เลย → ตอนนี้ `hono/secure-headers` (CSP · X-Frame-Options DENY · nosniff · Referrer-Policy · HSTS 1 ปี · COOP) ทุก response และ `/api/*` เป็น `no-store` · `test_security_headers_baseline.py` กันถดถอย
- **F3** better-auth เคยเตือน _"could not determine a client IP … single shared per-path bucket"_ (X-Forwarded-For ของ Railway มี 2 ค่า → ทั้งร้านใช้ถัง rate limit เดียว) →
  ตอนนี้เชื่อ IP จาก `X-Real-IP` อย่างเดียว (Railway edge เขียนทับทุก request) และ sign-in จำกัด **20 ครั้ง/นาที ต่อ IP** (`SIGN_IN_PER_MINUTE` ใน `apps/api/src/auth.ts`) ·
  ไม่มี X-Real-IP (เช่น รันตรงไม่ผ่าน edge) = ถังรวมถังเดียว + warn ใน log · probes ยังไม่แตะ sign-in: ถังต่อ IP ของ runner บน cloud อาจใช้ร่วมกับคนอื่น และ login ที่ล้มเหลวคือเสียงรบกวนใน log ของร้าน

known failure ใหม่ (ถ้ามี): ใส่ `known_failure` ใน `testsprite.json` (`sync: false`) — pytest ของเราถือเป็น `xfail(strict)` และ `sync` จะไม่อัปโหลด

## รันในเครื่อง — pytest ของเรา (ไม่ใช้ TestSprite · ไม่ต้องมี key)

```bash
pnpm --filter @ong/testsprite run probe http://localhost:28787             # stack e2e (compose ong-e2e)
pnpm --filter @ong/testsprite run probe https://ong-lom-thong-staging.up.railway.app   # อ่านอย่างเดียว · ไม่ใช่ช่วง UAT
ONG_BASE_URL=http://localhost:28787 python3 backend/test_health.py         # รันไฟล์เดียวแบบที่ TestSprite รัน
```

- ต้องมี `python3` ≥ 3.9 · สคริปต์สร้าง `tests/testsprite/.venv` เองจาก `requirements.txt` (`--require-hashes`) · host ของ production ต้อง `CONFIRM=yes`
- ผล: pass · `xfail` = known failure ยังพังอยู่ · **`XPASS(strict)` = ถูกแก้แล้ว** → ลบ `known_failure` ออกจาก `testsprite.json` ตั้ง `sync: true` แล้ว sync
- JUnit: `reports/probe-junit.xml`

## ตั้งค่าครั้งแรก (คน · ครั้งเดียว)

1. ประเมินผู้ให้บริการก่อน (ISO/IEC 27001 A.5.19–5.23): อ่าน privacy/terms · ขอรายงาน SOC 2 · บันทึกการตัดสินใจว่ารับความเสี่ยงข้อ 1 ได้เพราะส่งแต่ข้อมูลสมมติ
2. สร้าง environment `testing` บน Railway (`.railway/README.md` ขั้น 3–6 ด้วยชื่อ `testing`) ข้อมูลสมมติเท่านั้น · domain `ong-lom-thong-testing.up.railway.app`
   (ได้ชื่ออื่น = แก้ `project.hosts.testing` ใน `testsprite.json` ผ่าน PR)
3. สมัคร TestSprite ด้วยบัญชีขององค์กร (ไม่ใช่บัญชีส่วนตัว) เปิด 2FA · **ห้ามติดตั้ง GitHub App**
4. สร้าง project **backend** ชื่อที่พลาดไม่ได้ — ต้องตรง `^ong-lom-thong-(testing|staging-readonly)-backend$`
   ```bash
   read -rs TESTSPRITE_API_KEY && export TESTSPRITE_API_KEY          # วาง key · ไม่ลง history
   pnpm --filter @ong/testsprite exec testsprite project create --type backend \
     --name ong-lom-thong-testing-backend --url https://ong-lom-thong-testing.up.railway.app
   ```
5. ออก API key เฉพาะ repo นี้ → repo secret: `gh secret set TESTSPRITE_API_KEY` (วางตอนถาม) · rotate ทุก 90 วันหรือเมื่อคนออก
6. repo variables (ไม่ลับ):
   ```bash
   gh variable set TESTSPRITE_PROJECT_ID   --body <project-id>
   gh variable set TESTSPRITE_PROJECT_NAME --body ong-lom-thong-testing-backend
   gh variable set TESTSPRITE_TARGET_URL   --body https://ong-lom-thong-testing.up.railway.app
   ```
7. credit: `pnpm --filter @ong/testsprite exec testsprite usage` — free 150/เดือน · backend 0.2 credit/เทสต์/รอบ → 6 เทสต์ ≈ 1.2/คืน ≈ 36/เดือน
8. sync แล้วตรวจ (env 4 ตัวข้างบนต้องอยู่ใน shell):
   ```bash
   pnpm --filter @ong/testsprite run sync            # ดูแผน (ยังไม่เขียน)
   pnpm --filter @ong/testsprite run sync --apply    # อัปโหลด
   pnpm --filter @ong/testsprite run doctor          # ต้องผ่านทุกข้อ
   ```
9. Actions → `testsprite` → Run workflow ครั้งแรก แล้วดู step summary · หลังจากนั้นรันเองทุกคืน (schedule รันจาก `main` — ไฟล์ workflow ต้องถึง `main` ก่อน)

## เขียน · ตรวจ · sync · รัน

1. **เขียน**: `pnpm --filter @ong/testsprite exec testsprite test scaffold --type backend --out backend/test_x.py` (ไม่ต้องมี key) แล้วแปลงให้เป็นรูปแบบของ repo:
   บรรทัด `BASE_URL = os.environ.get(...)` · ท้ายไฟล์เรียกเทสต์ใต้ `ONG_PROBE_RUNNER` · docstring บอกตรวจอะไร/ทำไม/มาตรฐาน · อ่านอย่างเดียว · เพิ่ม entry ใน `testsprite.json`
2. **ตรวจ**: `pnpm --filter @ong/testsprite test` (manifest + guard · ออฟไลน์) และ `run probe <url>` กับ stack ในเครื่อง
   — `testsprite test lint` ตรวจได้เฉพาะ plan JSON ของ frontend (ไฟล์ `.py` ได้ exit 5)
3. **PR → review → merge** — โค้ดเทสต์ผ่านรีวิวเหมือนโค้ดอื่น
4. **sync** (คนทำ หลัง merge): `run sync` → `run sync --apply` · CI ไม่ sync ไม่สร้าง ไม่ลบเทสต์ (`sync --apply` ปฏิเสธเมื่อรันใน GitHub Actions)
   เทสต์บน cloud ที่ไม่อยู่ใน manifest ต้องลบเอง: `testsprite test delete <id> --confirm`
5. **รัน**: รอรอบคืน หรือ workflow_dispatch · ในเครื่อง `run run` (ใช้ credit)
6. เทสต์ที่ AI เสนอบน portal: `testsprite test code get <id> --out /tmp/x.py` → ตรวจ → แปลงตามข้อ 1 → PR → ลบตัวบน cloud แล้ว sync ตัวที่ commit

## CI — `.github/workflows/testsprite.yml`

schedule 02:37 เวลาไทย + workflow_dispatch · `permissions: contents: read` · action ปัก SHA · ไม่มี trigger จาก PR (ไม่มี secret ให้ fork/PR ขโมย)

| ขั้น       | ทำอะไร                                                                                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (job `if`) | repo นี้ และ `vars.TESTSPRITE_PROJECT_ID != ''` — ยังไม่ตั้ง = **skipped** ไม่ใช่แดงทุกคืน · ปิดชั่วคราว = ลบตัวแปรนี้                                                                          |
| install    | `pnpm install --frozen-lockfile --filter @ong/testsprite` — CLI ปักตรงตัว + integrity ใน lockfile · ไม่ใช้ cache                                                                                |
| doctor     | **fail-closed**: CLI = เวอร์ชันที่ปัก · มี key · ชื่อ project ตรงตัวแปรและรูปแบบ · ชนิด backend · URL ใน allow-list · ไม่มีเทสต์นอก manifest · **โค้ดบน cloud = โค้ดใน repo** (ที่ render แล้ว) |
| run        | `test run --all --wait` → `reports/` (junit · summary · run.json) → ตรวจโค้ดซ้ำหลังรัน · `continue-on-error`                                                                                    |
| classify   | อ่าน `reports/outcome.json` → annotation + step summary                                                                                                                                         |
| artifact   | `reports/` เก็บ **7 วัน** (อาจมี response จาก environment เป้าหมาย)                                                                                                                             |

| หมวด                                                                                                                                                     | job                     | ทำอะไรต่อ                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------- |
| `passed`                                                                                                                                                 | เขียว                   | —                                                                 |
| `tests-failed`                                                                                                                                           | เขียว + warning         | ดูตารางใน summary · แก้แอป หรือแก้เทสต์ผ่าน PR                    |
| `auth` (3) · `credits` (12) · `client-too-old` (14) · `validation` (5 รวมไม่มีเทสต์ให้รัน) · `timeout` · `unavailable` · `guard` · `integrity` · `error` | **แดง** — ไม่ได้รันจริง | ชั้นเทสต์ที่ตายเงียบห้ามดูเขียว — ข้อความใน annotation บอกวิธีแก้ |

CLI อยู่ใน env ที่ตัด `TESTSPRITE_API_URL` / `TESTSPRITE_PORTAL_URL` / `TESTSPRITE_PROFILE` / `NODE_OPTIONS` ออก (กัน key ถูกส่งไป host อื่น) · ปิด telemetry (`TESTSPRITE_NO_TELEMETRY` `DO_NOT_TRACK`) · ไม่พิมพ์โค้ดบน cloud ลง log (อาจมี credential ที่ TestSprite แทรก)

## อัปเดต CLI

`@testsprite/testsprite-cli` ปักตรงตัวใน `package.json` · 0.x ออกเกือบทุกสัปดาห์ · server บังคับเวอร์ชันขั้นต่ำ (HTTP 426 → exit 14 `client-too-old`) และแก้ช่องโหว่เฉพาะเวอร์ชันล่าสุด
→ รับ PR ของ Renovate เร็ว แต่**ไม่ automerge**: อ่าน CHANGELOG (minor ของ 0.x เปลี่ยนพฤติกรรมได้) → `pnpm --filter @ong/testsprite test` → workflow_dispatch บน branch นั้น → merge

## ระยะ 2 — เทสต์ที่ต้อง login (มาสก์เลขบัตร R13 · สาขา fail-closed) — ยังไม่ทำ

ตรวจแล้ว (CLI 0.13.0 · docs 28 ก.ย. 2569) — ไม่เดา:

- `project credential` (free) มี `public` · `Bearer token` · `API key` (`X-API-Key`) · `basic token` — TestSprite **แทรกบล็อก `__AUTH_CREDENTIAL__` / `__AUTH_TYPE__` / `__AUTH_HEADERS__` ไว้หัวโค้ด** ของเทสต์ backend ทุกตัว (ไม่ใช่ env var)
- **ไม่มีชนิด cookie** · better-auth ของเราอ่าน cookie ที่เซ็นด้วย secret (`getSignedCookie`) และไม่ได้เปิด plugin `bearer` (`test_bearer_token_is_not_accepted` ยืนยัน) → Bearer/API key ใช้ตรง ๆ ไม่ได้
- `project auto-auth` (แผน Pro) login แล้วดึง token จาก JSON มาฉีดเป็น `Cookie: name=token` — ส่ง `Origin` ไม่ได้ (CSRF guard ตอบ 403) และ token ใน body ยังไม่เซ็น → ใช้ไม่ได้
- `--produces/--needs` ใน CLI คุมแค่ลำดับ wave — วิธีส่งค่าข้ามเทสต์ในโค้ดไม่มีเอกสาร · session อายุ 12 ชม. → credential แบบ static ข้ามคืนไม่ได้

แนวทาง (ต้องพิสูจน์กับบัญชีจริงบน `testing` ก่อนใช้):

- **A (แนะนำ)** เทสต์ที่ต้อง login รันด้วย pytest ของเราใน GitHub Actions (รหัสผ่านใน GitHub secret) ยิง `testing` — รหัสผ่านและ response ที่ login แล้วไม่ไปถึง TestSprite
- **B (ถ้าต้องการบน TestSprite)** เก็บ `email:password` ของบัญชีทดสอบด้วย `project credential <id> --type "API key" --credential-file <file>` → เทสต์อ่าน `__AUTH_CREDENTIAL__`
  แล้ว login เองหนึ่งครั้งต่อไฟล์ด้วย `requests.Session` + `Origin` ของแอป · ต้องยืนยันก่อนว่า server แทรกบล็อกให้ backend project จริง (`rewroteCount`) · ยอมรับว่า TestSprite เก็บรหัสผ่านนั้น
- เงื่อนไขร่วม: บัญชีสมมติ 2 บัญชี (role `staff` สาขา A / สาขา B — ทดสอบข้ามสาขา) สร้างด้วย `node dist/create-user.js` บน `testing` เท่านั้น · ห้าม admin/`--view-all` ·
  login ครั้งเดียวต่อบัญชีต่อรอบ (sign-in 20 ครั้ง/นาที ต่อ IP — F3) · ลูกค้าในเทสต์ = seed สมมติชื่อขึ้นต้น "ทดสอบ" · **ห้ามสร้างใบรับซื้อจากเทสต์บน TestSprite** (PDF immutable — สร้างแล้วลบไม่ได้)

## MCP server (ทางเลือก · ระดับผู้ใช้เท่านั้น · ไม่ใช้ใน CI)

คำสั่งตามเอกสาร TestSprite (Claude Code):

```bash
claude mcp add TestSprite --env API_KEY=your_api_key -- npx @testsprite/testsprite-mcp@latest
```

- scope ค่าเริ่มต้น `local` = เก็บใน `~/.claude.json` ของเครื่องนั้น ไม่เข้า repo · **ห้ามใส่ TestSprite ลง `.mcp.json` ของ repo** (`--scope project` — ไฟล์นั้นมีแค่ shadcn และ commit อยู่) · key ถูกเก็บเป็น plaintext ใน `~/.claude.json`
- แนะนำปักเวอร์ชันแทน `@latest` (เช่น `@testsprite/testsprite-mcp@0.0.46`) — แพ็กเกจเผยแพร่โดยบัญชี npm ส่วนตัว ไม่มี provenance และรันด้วยสิทธิ์ของผู้ใช้
- **ราคาความเป็นส่วนตัว**: MCP อัปโหลด PRD + **สรุป codebase ที่ agent เขียน** (`codeSummary`) + แผนเทสต์และ log ไปที่ TestSprite — เท่ากับส่งโครงสร้างระบบ/กฎธุรกิจออกนอกประเทศ
  ใช้ได้เฉพาะเมื่อยอมรับเรื่องนี้แล้ว และชี้ได้เฉพาะ `testing`
- ไลเซนส์ BUSL-1.1 ให้สิทธิ์ "non-production purposes" เท่านั้น — ให้ฝ่ายกฎหมายดูก่อนใช้กับโปรเจกต์ production
- MCP เขียน `testsprite_tests/` (PRD · แผน · `TC*.py` · `tmp/` ที่มี config และ code summary) — ห้าม commit · เทสต์ที่อยากเก็บให้แปลงเข้า `backend/` ตามขั้นตอนด้านบน

## มาตรฐานที่ใช้

- **PDPA พ.ศ. 2562** ม.26 (ข้อมูลอ่อนไหว) · ม.28–29 (โอนข้อมูลไปต่างประเทศ — เลี่ยงด้วยข้อมูลสมมติเท่านั้น) · ม.37 (มาตรการรักษาความปลอดภัย)
- **ISO/IEC 27001:2022** A.5.19–5.23 (supplier · cloud service) · A.8.31 (แยก environment) · A.8.32 (change management — manifest ผ่าน PR) · A.8.33 (test information)
- **NIST SP 800-218 SSDF 1.1** PO.3.2 (toolchain ปัก/ตรวจ integrity) · PW.4.4 (ตรวจ integrity ของ component — lockfile/hash) · PW.8.2 (dynamic testing) · RV.1.1 (หาช่องโหว่ต่อเนื่อง)
- **OWASP Top 10 CI/CD Security Risks** CICD-SEC-1 (ไม่มี merge gate นอก ci.yml) · -3 (dependency pin) · -4 (ไม่มี trigger จาก PR · ไม่มี `${{ }}` ใน `run:`) · -6 (key อยู่แค่สองขั้น · ตัด endpoint override) ·
  -7 (สิทธิ์ต่ำสุด) · -8 (บริการภายนอก: dormant · allow-list · ไม่ติดตั้ง App) · -9 (โค้ดบน cloud = โค้ดใน repo ก่อน/หลังรัน) · -10 (summary + artifact)
- **OWASP ASVS 5.0** V3.3 · V3.4 · V3.5 · V4.1 · V8 · V13.4 · V16.5 · **OWASP API Security Top 10 2023** API1 · API2 · API8 · CWE-209 · CWE-352 · CWE-942 · CWE-1021
- GitHub _Security hardening for GitHub Actions_ (ปัก action ด้วย SHA เต็ม · `GITHUB_TOKEN` อ่านอย่างเดียว · ค่าจากภายนอกผ่าน `env:`)

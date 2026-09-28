# Railway — project `Ong Lom Thong` (Singapore)

`railway.ts` คือแหล่งเดียวของโครงสร้างบน Railway (Infrastructure as Code) — ใช้แทน `railway.json` ที่ถูก deprecate
Railway **ไม่อ่านไฟล์นี้ตอน deploy** · แก้ไฟล์แล้วต้อง `pnpm railway:plan` → `pnpm railway:apply` เอง

| resource          | ชนิด                                                            | หมายเหตุ                                                                                        |
| ----------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Office`          | service (Dockerfile `apps/api/Dockerfile`, context = root repo) | เสิร์ฟ web + REST · pre-deploy: migrate (ที่ไม่ใช่ production: + seed) · healthcheck `/healthz` |
| `PDF (Gotenberg)` | service (root `services/gotenberg`)                             | private เท่านั้น · `PORT=3000` · basic auth · healthcheck `/health`                             |
| `Postgres`        | database (Postgres 18)                                          | `DATABASE_URL` อ้างจาก api                                                                      |
| `Media`           | bucket (region `sin`)                                           | private · virtual-hosted style · **ไม่มี versioning/object lock** → สำเนา off-site รายคืน       |

environment → branch: `dev` → `dev` · `testing` → `testing` · `staging` → `staging` · `production` → `main` · ทุกตัวรอ GitHub Actions ผ่านก่อน (Wait for CI)
ชื่ออื่นไฟล์จะหยุดทันที · สร้าง environment เฉพาะที่ต้องใช้ (แต่ละตัวมี Postgres/bucket/gotenberg ของตัวเอง = ค่าใช้จ่ายเพิ่ม)
จะเพิ่ม `dev` หรือ `testing`: ทำขั้น 3–6 ด้วยชื่อนั้นแทน `staging`

## สถานะ (28 ก.ย. 2569)

| environment  | สถานะ                                                                                  | URL                                          |
| ------------ | -------------------------------------------------------------------------------------- | -------------------------------------------- |
| `staging`    | api · gotenberg · Postgres online · bucket `Media`                                     | https://ong-lom-thong-staging.up.railway.app |
| `production` | api · gotenberg · Postgres online · bucket `Media` (แยก key จาก staging) · ยังไม่ seed | https://ong-lom-thong.up.railway.app         |

staging สร้างจาก dashboard ก่อนมี IaC: rename bucket `bundled-taco` → `Media` และ service `ong-lom-thong` → `api` ให้ IaC รับไปแก้ในที่ (ไม่มีการลบ)
ล้างแล้ว 28 ก.ย.: volume `postgres-volume` และ `postgres-volume-GJW5` (detached · ถูกตั้งลบถาวร 29 ก.ย. — กู้ได้ก่อนนั้น) · service `@ong/web` `@ong/api` ไม่มีแล้ว
staging: Pre-deploy Timeout ของ `api` = 300 วินาที (ตั้งผ่าน API `serviceInstanceUpdate`)

## ตั้งครั้งแรก (staging)

ต้องทำโดยคนที่มีบัญชี Railway — ขั้น 2 ต้องเป็นเจ้าของบัญชี GitHub `tanasatha-mahathep`
branch `staging` บน GitHub ต้องมีโค้ดชุดนี้แล้ว (apply สร้าง service แล้ว deploy ทันทีจาก branch นั้น)
รัน `railway:plan` / `railway:apply` จาก directory ที่ `railway link` แล้วเท่านั้น — **ห้ามรันใน `railway run` / `railway shell`** (ไฟล์จะหยุดเพราะไม่รู้ชื่อ environment)

1. ติดตั้ง CLI (≥ 5.42.1) แล้ว login
   ```bash
   brew install railway
   railway login            # ไม่มี browser: railway login --browserless
   ```
2. ติดตั้ง [Railway GitHub App](https://github.com/apps/railway-app/installations/new) ให้บัญชี `tanasatha-mahathep` เข้าถึง repo `ong-lom-thong`
3. ตั้ง region เริ่มต้นของ workspace เป็น Singapore (Account Settings) แล้วสร้าง project + environment
   ```bash
   railway init --name "Ong Lom Thong"   # ได้ environment production มาด้วย (project นี้มีอยู่แล้ว — ข้ามได้)
   railway environment new staging
   railway link --project "Ong Lom Thong" --environment staging
   ```
4. สร้างค่าลับแล้ว apply — อ่านจาก `RAILWAY_SET_*` เท่านั้น (แอปไม่ใช้ชื่อนี้ · `.env` ของเครื่อง dev ทับค่าจริงไม่ได้) แล้ว seal ไว้ใน Railway
   ค่าต้องยาว ≥ 32 ตัวอักษร ไม่งั้นไฟล์หยุด
   ```bash
   export RAILWAY_SET_GOTENBERG_PASSWORD="$(openssl rand -hex 32)"
   export RAILWAY_SET_BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
   pnpm railway:plan        # ตรวจ: สร้าง 4 resource · ไม่มีลบ · ดูค่าที่ไม่ลับด้วย --show-values
   pnpm railway:apply
   unset RAILWAY_SET_GOTENBERG_PASSWORD RAILWAY_SET_BETTER_AUTH_SECRET
   ```
5. สร้าง domain สาธารณะให้ api (IaC ไม่จัดการ generated domain)
   ```bash
   railway domain --service Office
   ```
6. ตั้ง **Pre-deploy Timeout** ของ service `Office` เป็น 300 วินาที ใน dashboard (Settings → Deploy) — IaC และ `railway environment edit` ตั้งค่านี้ไม่ได้ · ค่าเริ่มต้นไม่มีเวลาจำกัด (migration มี `lock_timeout` 10 วินาทีกันค้างอีกชั้น)
7. ต่อจากนี้ push branch `staging` → CI ผ่าน → Railway deploy

## ตรวจหลัง deploy

```bash
railway logs --service "PDF (Gotenberg)"  # ต้องเห็น "server started on [::]:3000" (ไม่ใช่ 8080)
railway logs --service Office        # pre-deploy: "migrations applied" + "seeded reference data"
railway variable list --service Office --kv  # GOTENBERG_URL ต้อง resolve เป็น http://gotenberg.railway.internal:3000
curl https://<domain>/healthz
```

ดู region ของ Postgres ใน dashboard ด้วย — มีรายงานว่าบางครั้งไม่ตามค่า region ที่ตั้ง

## หมุนค่าลับ

export `RAILWAY_SET_*` ค่าใหม่แล้ว `pnpm railway:apply` — ไม่ export = `preserve()` คงค่าเดิม
`RAILWAY_SET_GOTENBERG_PASSWORD` ใช้ทั้งใน `PDF (Gotenberg)` และ `Office` — หมุนในการ apply ครั้งเดียวจึงตรงกันเสมอ

## production

ตั้งแล้ว 28 ก.ย. — `railway link --environment production` แล้วทำขั้น 4–5 ด้วยค่าลับชุดใหม่ (ค่า sealed ไม่ถูกคัดลอกข้าม environment)

เรื่องที่เจอตอนตั้ง production (แก้แล้ว แต่ต้องรู้ไว้):

- **IaC สร้าง bucket ใน environment ที่สองไม่ได้** — apply ขึ้น ✓ แต่ไม่มี bucket · แก้ด้วย API `environmentPatchCommit` ใส่ `buckets.<bucket id> = { region: "sin", isCreated: true }` แล้ว plan กลับมา up to date
- **Postgres ของ production ใช้ volume ชื่อ `postgres-volume` ซ้ำกับ instance ใน staging ที่ถูกตั้งลบ** (29 ก.ย.) · API แสดงว่าตั้งลบเฉพาะ instance ของ staging แต่เอกสารไม่ยืนยัน → **เจ้าของบัญชีกด restore ในอีเมล "volume deleted" ของ `postgres-volume`** กันไว้ก่อน
- **ชื่อ service/bucket ผูกกับ IaC** — เปลี่ยนชื่อใน dashboard แล้วต้องแก้ค่าคงที่ใน `railway.ts` (`APP_SERVICE` `PDF_SERVICE` `BUCKET`) ก่อน apply ครั้งถัดไป ไม่งั้น plan จะสร้างใหม่แล้ว **ลบตัวเดิม** · Railway แก้ reference ใน variable ให้เองตอนเปลี่ยนชื่อ
- **deploy รออนุมัติ (NEEDS_APPROVAL)** — push จากบัญชี GitHub ที่ไม่ผูกกับบัญชี Railway ที่เป็นสมาชิก project (เช่น `danglebz`) Railway จะไม่ deploy เองจนกว่าจะกด Approve · แก้ถาวร: สมัคร/ผูก Railway ด้วย GitHub นั้นแล้วเชิญเข้า workspace
- ค่าที่ไม่ได้ประกาศใน `railway.ts` จะถูกล้างตอน apply (เช่น pre-deploy timeout) — ประกาศทุกค่าที่ต้องการไว้ในไฟล์
  production ไม่ seed อัตโนมัติ — seed เองหลังได้รหัสสาขา 5 หลักจริง (`railway ssh --service Office -- node dist/seed.js`)

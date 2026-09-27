# Railway — project `ong-pos` (Singapore)

`railway.ts` คือแหล่งเดียวของโครงสร้างบน Railway (Infrastructure as Code) — ใช้แทน `railway.json` ที่ถูก deprecate
Railway **ไม่อ่านไฟล์นี้ตอน deploy** · แก้ไฟล์แล้วต้อง `pnpm railway:plan` → `pnpm railway:apply` เอง

| resource    | ชนิด                                                            | หมายเหตุ                                                                                  |
| ----------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `api`       | service (Dockerfile `apps/api/Dockerfile`, context = root repo) | เสิร์ฟ web + REST · pre-deploy: migrate (staging: + seed) · healthcheck `/healthz`        |
| `gotenberg` | service (root `services/gotenberg`)                             | private เท่านั้น · `PORT=3000` · basic auth · healthcheck `/health`                       |
| `Postgres`  | database (Postgres 18)                                          | `DATABASE_URL` อ้างจาก api                                                                |
| `files`     | bucket (region `sin`)                                           | private · virtual-hosted style · **ไม่มี versioning/object lock** → สำเนา off-site รายคืน |

environment: `staging` deploy จาก branch `staging` · `production` จาก `main` · ทั้งคู่รอ GitHub Actions ผ่านก่อน (Wait for CI)

## ตั้งครั้งแรก (staging)

ต้องทำโดยคนที่มีบัญชี Railway — ขั้น 2 ต้องเป็นเจ้าของบัญชี GitHub `tanasatha-mahathep`

1. ติดตั้ง CLI (≥ 5.42.1) แล้ว login
   ```bash
   brew install railway
   railway login            # ไม่มี browser: railway login --browserless
   ```
2. ติดตั้ง [Railway GitHub App](https://github.com/apps/railway-app/installations/new) ให้บัญชี `tanasatha-mahathep` เข้าถึง repo `ong-lom-thong`
3. ตั้ง region เริ่มต้นของ workspace เป็น Singapore (Account Settings) แล้วสร้าง project + environment
   ```bash
   railway init --name ong-pos        # ได้ environment production มาด้วย
   railway environment new staging
   railway link --project ong-pos --environment staging
   ```
4. สร้างค่าลับแล้ว apply — ค่าลับอ่านจาก shell ครั้งแรกเท่านั้น แล้ว seal ไว้ใน Railway (ไม่ลง git)
   ```bash
   export GOTENBERG_PASSWORD="$(openssl rand -hex 24)"
   export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
   pnpm railway:plan        # ตรวจ: สร้าง 4 resource · ไม่มีลบ
   pnpm railway:apply
   unset GOTENBERG_PASSWORD BETTER_AUTH_SECRET
   ```
5. สร้าง domain สาธารณะให้ api (IaC ไม่จัดการ generated domain)
   ```bash
   railway domain --service api
   ```
6. push branch `staging` → CI ผ่าน → Railway deploy

## ตรวจหลัง deploy

```bash
railway logs --service gotenberg     # ต้องเห็น "server started on [::]:3000" (ไม่ใช่ 8080)
railway logs --service api           # pre-deploy: "migrations applied" + "seeded reference data"
railway variable list --service api --kv  # GOTENBERG_URL ต้อง resolve เป็น http://gotenberg.railway.internal:3000
curl https://<domain>/healthz
```

ดู region ของ Postgres ใน dashboard ด้วย — มีรายงานว่าบางครั้งไม่ตามค่า region ที่ตั้ง

## หมุนค่าลับ

export ค่าใหม่แล้ว `pnpm railway:apply` — ไม่ export = `preserve()` คงค่าเดิม
`GOTENBERG_PASSWORD` ใช้ทั้งใน `gotenberg` และ `api` ต้องหมุนพร้อมกันในการ apply ครั้งเดียว

## production

`railway link --environment production` แล้วทำขั้น 4–5 ด้วยค่าลับชุดใหม่ (ค่า sealed ไม่ถูกคัดลอกข้าม environment)
production ไม่ seed อัตโนมัติ — seed เองหลังได้รหัสสาขา 5 หลักจริง (`railway ssh --service api -- node dist/seed.js`)

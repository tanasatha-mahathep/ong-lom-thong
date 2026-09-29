# Railway — project `Ong Lom Thong` (Singapore)

`railway.ts` คือแหล่งเดียวของโครงสร้างบน Railway (Infrastructure as Code) — ใช้แทน `railway.json` ที่ถูก deprecate
Railway **ไม่อ่านไฟล์นี้ตอน deploy** · แก้ไฟล์แล้วต้อง `pnpm railway:plan` → `pnpm railway:apply` เอง

| resource          | ชนิด                                                            | หมายเหตุ                                                                                                               |
| ----------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `Office`          | service (Dockerfile `apps/api/Dockerfile`, context = root repo) | เสิร์ฟ web + REST · pre-deploy: migrate (ที่ไม่ใช่ production: + seed) · healthcheck `/healthz`                        |
| `PDF (Gotenberg)` | service (root `services/gotenberg`)                             | private เท่านั้น · `PORT=3000` · basic auth · healthcheck `/health`                                                    |
| `Nightly Backup`  | cron service (root `services/backup`)                           | 02:17 น. เวลาไทยทุกคืน · `pg_dump` + `rclone copy` → bucket `Backup` · ไม่มี domain · [ดูด้านล่าง](#สำรองข้อมูลรายคืน) |
| `Postgres`        | database (Postgres 18)                                          | `DATABASE_URL` อ้างจาก api และ `Nightly Backup`                                                                        |
| `Media`           | bucket (region `sin`)                                           | private · virtual-hosted style · **ไม่มี versioning/object lock** → สำเนารายคืนไป `Backup`                             |
| `Backup`          | bucket (region `sin`)                                           | private · dump database + สำเนาไฟล์จาก `Media` · เขียนโดย `Nightly Backup` เท่านั้น                                    |

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
   pnpm railway:plan        # ตรวจ: สร้าง 6 resource · ไม่มีลบ · ดูค่าที่ไม่ลับด้วย --show-values
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

## สำรองข้อมูลรายคืน

service `Nightly Backup` (cron · โค้ด `services/backup/`) รันทุกคืน 02:17 น. เวลาไทย แล้วจบเอง

- cron ของ Railway เป็น **UTC เสมอ** → `17 19 * * *` = 19:17 UTC = 02:17 น. ของวันถัดไปตามเวลาไทย (UTC+7 ไม่มี daylight saving) · แก้ที่ `BACKUP_CRON` ใน `railway.ts`
- รอบก่อนยังไม่จบ Railway ข้ามรอบนั้น · รันพัง = run นั้นขึ้น failed (restart policy `NEVER` ไม่วนรันซ้ำ)
- ปลายทาง: bucket `Backup` ของ environment เดียวกัน (Railway สร้าง key ให้เอง — ไม่มีค่าลับให้ตั้ง)

| ส่วน     | ทำอะไร                                                                                                                                                                          | ที่อยู่ใน bucket `Backup`                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| database | `pg_dump -Fc` (client 18) → อ่านกลับทั้งไฟล์ด้วย `pg_restore --file=/dev/null` (`--list` อ่านแค่ TOC — ไฟล์ขาดครึ่งก็ผ่าน) → อัปโหลด → เห็นไฟล์ในปลายทางแล้วจึง prune dump เก่า | `<environment>/postgres/<environment>-<UTC>.dump` |
| files    | `rclone copy --immutable --metadata` จาก `Media` — **ไม่ใช่ sync**: ไฟล์ที่ถูกลบจาก `Media` ยังอยู่ในสำเนา · ไม่ prune เลย                                                      | `<environment>/files/<key เดิม>`                  |

- ชื่อ dump เช่น `production-20260929T191700Z.dump` (เวลา UTC ตอนเริ่ม dump)
- เก็บ dump: **ทุกไฟล์ของ 30 วันล่าสุดที่มี dump + ไฟล์ล่าสุดของแต่ละเดือน 12 เดือน** (`BACKUP_KEEP_DAILY` / `BACKUP_KEEP_MONTHLY` ใน `railway.ts`) · นับวันที่มีไฟล์ ไม่ใช่อายุ — cron หยุดไปนานของเก่าก็ไม่หาย · ไฟล์ที่ไม่ตรงรูปชื่อไม่ถูกลบ · อัปโหลดไม่สำเร็จ/ยืนยันไม่ได้ = ไม่ prune
- **ตรวจขนาดก่อน prune** (`BACKUP_MIN_SIZE_PERCENT` 50): บิลไม่ถูกลบ → dump ใหม่ที่เล็กกว่า 50% ของ dump ก่อนหน้า หรือของ dump ใดที่ถึงคิวลบ = database อาจถูกล้าง/เริ่มใหม่ — dump ใหม่ยังเก็บ แต่**ไม่ลบอะไร**และ run fail ทุกคืนจนกว่าคนจะตัดสิน (ไม่งั้นอีก 30 คืน dump ก่อนเกิดเหตุถูก prune หมด) · ดู "dump เล็กลงผิดปกติ"
- `--immutable`: ไฟล์ใน `Media` ที่ถูกเขียนทับ (ใบรับซื้อ/สำเนาบัตรห้ามแก้ — แม้ byte เดิมก็นับ) → ส่วน files fail ทุกคืน และสำเนาเดิมไม่ถูกเขียนทับ — **ต้องตรวจทันที** ดู "ไฟล์ใน Media ถูกเขียนทับ"
- **ไม่มีรอบไหนค้างได้**: `pg_dump --lock-wait-timeout` (`BACKUP_LOCK_WAIT_TIMEOUT` 15 นาที — ตารางถูกล็อก `ACCESS EXCLUSIVE` ค้าง = fail) · ทั้งรอบมีเส้นตาย `BACKUP_TIMEOUT_SECONDS` (6 ชั่วโมง) — คำสั่งที่ยังทำงานเมื่อถึงเส้นตายถูก TERM (อีก 30 วินาที KILL) · รอบที่ค้าง = Railway ข้ามทุกรอบถัดไป backup หยุดเงียบ จึงต้องมีเส้นตาย
  - เส้นตายบังคับที่คำสั่งลูกทีละตัว (pg_dump · pg_restore · rclone) ไม่ใช่ `timeout` ครอบ entrypoint: สคริปต์เป็น PID 1 ใน container และ signal ที่ส่งจากใน container ถึง PID 1 ถูกทิ้ง (ทดสอบกับ image นี้: `timeout 2` เป็น entrypoint → `sleep 12` รันครบ exit 0)
  - ทดสอบกับ image จริง: ถือ `LOCK TABLE branch IN ACCESS EXCLUSIVE MODE` ไว้ → pg_dump fail ใน 5 วินาที (`BACKUP_LOCK_WAIT_TIMEOUT=5s`) · lock wait 10 นาที + เส้นตาย 10 วินาที → หยุดที่ 11 วินาที · S3 ค้าง (`docker pause`) → rclone หยุดที่เส้นตาย
- database กับ files ทำแยกกัน — ส่วนหนึ่งพัง อีกส่วนยังทำ แล้ว exit ≠ 0 · บรรทัดสรุปท้ายรอบบอกผลทั้งสองส่วนเสมอ (files พังทุกคืนต้องไม่บังผลของ database): `backup: all done — database: ok (<ชื่อ dump>) · files: ok` หรือ `backup: FAILED — database: ok (<ชื่อ dump>) · files: FAILED (exit 6)`

> **ข้อจำกัด:** bucket `Backup` อยู่ในบัญชี/project Railway เดียวกัน — กันข้อมูลเสีย/ถูกลบในแอป, database พัง และไฟล์ใน `Media` หาย แต่ **ไม่กันกรณีบัญชีหรือ project Railway หาย** · สำเนานอก Railway (R2/B2) เป็นงานเสริมความปลอดภัยในอนาคต — ดู "ต่อสำเนานอก Railway" ด้านล่าง

### ตัวแปร (ประกาศใน `railway.ts` ครบ — ไม่มีค่าที่ต้อง export ตอน apply)

| ตัวแปร                                                                                        | ค่า                                                                             |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                | reference `Postgres`                                                            |
| `BACKUP_ENVIRONMENT`                                                                          | ชื่อ environment (prefix + ชื่อไฟล์)                                            |
| `BACKUP_KEEP_DAILY` · `BACKUP_KEEP_MONTHLY`                                                   | `30` · `12` (daily ≥ 1 · monthly ≥ 0 — ผิดรูป = หยุดทันที)                      |
| `BACKUP_MIN_SIZE_PERCENT`                                                                     | `50` (0–100 · `0` = ปิดการตรวจขนาด — ไม่แนะนำ)                                  |
| `BACKUP_LOCK_WAIT_TIMEOUT`                                                                    | `15min` (ต้องมีหน่วย `ms` `s` `min` `h` — ตัวเลขเปล่าใน Postgres = มิลลิวินาที) |
| `BACKUP_TIMEOUT_SECONDS`                                                                      | `21600` = 6 ชั่วโมง (1–86399 — ต้องจบก่อนรอบถัดไป)                              |
| `S3_ENDPOINT` `S3_REGION` `S3_BUCKET` `S3_ACCESS_KEY` `S3_SECRET_KEY` `S3_FORCE_PATH_STYLE`   | reference bucket `Media` (ต้นทางของไฟล์)                                        |
| `BACKUP_S3_ENDPOINT` `…_REGION` `…_BUCKET` `…_ACCESS_KEY` `…_SECRET_KEY` `…_FORCE_PATH_STYLE` | reference bucket `Backup` (ปลายทาง)                                             |
| `BACKUP_S3_PROVIDER`                                                                          | `Other` (ชื่อ provider ของ rclone s3)                                           |

สคริปต์ตั้ง rclone จาก env ล้วน (`RCLONE_CONFIG_*`) — ไม่มี `rclone.conf` · ค่าลับไม่ผ่าน argv · ปลายทางเป็น bucket เดียวกับต้นทาง = ปฏิเสธ

### เปิดใช้ (ครั้งแรก)

1. branch ของ environment นั้นมีโค้ดชุดนี้แล้ว (เช่น promote ถึง `staging`)
2. `railway link --environment staging` แล้ว `pnpm railway:plan` — ต้องเห็นสร้าง 2 resource (`Backup` bucket · `Nightly Backup` service) **ไม่มีลบ** และ `Office` ไม่มี diff
3. `pnpm railway:apply` → ตรวจตาม "ตรวจผลการรัน" หลังรอบแรก · ผ่านแล้วค่อยทำ production
4. production: ทำขั้น 2–3 ด้วย `--environment production` แล้ว **ตรวจว่ามี bucket `Backup` จริง** (dashboard หรือ `railway variable list --service "Nightly Backup" --kv` ต้องเห็น `BACKUP_S3_BUCKET` มีค่า) — IaC สร้าง bucket ใน environment ที่สองไม่ได้ (ดู "production" ด้านล่าง) · แก้แบบเดียวกับ `Media`: API `environmentPatchCommit` ใส่ `buckets.<id ของ Backup> = { region: "sin", isCreated: true }` แล้ว `pnpm railway:plan` ต้อง up to date

### ตรวจผลการรัน

```bash
railway logs --service "Nightly Backup"   # รอบล่าสุด: "backup: all done — database: ok (…) · files: ok" · pg_dump (PostgreSQL) 18.x · "prune: …"
```

ยังไม่ได้ยืนยันว่า Railway มีปุ่มสั่งรัน cron ทันที — ถ้าไม่มี ให้ตรวจหลังรอบแรก (02:17 น.) · ดูรายการไฟล์ใน bucket ด้วย rclone ตาม "ตั้ง rclone บนเครื่อง" แล้ว

```bash
rclone lsl "backup:$BACKUP_S3_BUCKET/production/postgres/"   # มี dump ของคืนล่าสุด ขนาดไม่ต่างจากคืนก่อนมาก
rclone size "backup:$BACKUP_S3_BUCKET/production/files/"     # จำนวนไฟล์ ≥ ใน Media: rclone size "media:$S3_BUCKET"
```

ทุกเดือนควรซ้อมกู้คืน (ด้านล่าง) อย่างน้อยหนึ่งครั้ง — backup ที่ไม่เคยกู้ = ยังไม่รู้ว่าใช้ได้

### ตั้ง rclone บนเครื่อง (อ่าน bucket `Backup` / `Media`)

ค่าจาก `railway variable list --service "Nightly Backup" --kv` (environment ที่ link อยู่) · ใส่ใน shell เท่านั้น ห้ามเขียนลงไฟล์ใน repo

Railway bucket เป็น virtual-hosted style — ต้องตั้ง `FORCE_PATH_STYLE=false` (provider `Other` ของ rclone ใช้ path style เป็นค่าเริ่มต้น · service เองก็ตั้ง `false`)

```bash
export RCLONE_CONFIG=/dev/null   # ไม่ใช้/ไม่เขียน rclone.conf
export RCLONE_CONFIG_BACKUP_TYPE=s3 RCLONE_CONFIG_BACKUP_PROVIDER=Other RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET=true
export RCLONE_CONFIG_BACKUP_FORCE_PATH_STYLE=false
export RCLONE_CONFIG_BACKUP_ENDPOINT=<BACKUP_S3_ENDPOINT> RCLONE_CONFIG_BACKUP_REGION=<BACKUP_S3_REGION>
export RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID=<BACKUP_S3_ACCESS_KEY> RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY=<BACKUP_S3_SECRET_KEY>
export BACKUP_S3_BUCKET=<BACKUP_S3_BUCKET>
# Media (ค่า S3_* ของ service เดียวกัน)
export RCLONE_CONFIG_MEDIA_TYPE=s3 RCLONE_CONFIG_MEDIA_PROVIDER=Other RCLONE_CONFIG_MEDIA_NO_CHECK_BUCKET=true
export RCLONE_CONFIG_MEDIA_FORCE_PATH_STYLE=false
export RCLONE_CONFIG_MEDIA_ENDPOINT=<S3_ENDPOINT> RCLONE_CONFIG_MEDIA_REGION=<S3_REGION>
export RCLONE_CONFIG_MEDIA_ACCESS_KEY_ID=<S3_ACCESS_KEY> RCLONE_CONFIG_MEDIA_SECRET_ACCESS_KEY=<S3_SECRET_KEY>
export S3_BUCKET=<S3_BUCKET>
```

### กู้คืน database (ซ้อมใน scratch DB — ทดสอบแล้วกับ Postgres 18 + migration จริง: จำนวนแถวทุกตาราง ฟังก์ชัน และ migration ตรงกับต้นทาง)

dump ของ production มี**เลขบัตรประชาชนเต็ม** — ซ้อมบนเครื่องเจ้าของเท่านั้น ลบไฟล์และ database ทิ้งเมื่อเสร็จ · **ห้าม restore ข้อมูล production ลง staging**
ต้องใช้ `pg_restore` รุ่น 18 (รุ่นเก่ากว่าอ่าน dump ของ 18 ไม่ได้) — ใช้ใน container `postgres` ของ compose

```bash
rclone lsf "backup:$BACKUP_S3_BUCKET/production/postgres/"                      # เลือกไฟล์
rclone copyto "backup:$BACKUP_S3_BUCKET/production/postgres/production-<UTC>.dump" ./restore.dump
make infra-up
docker compose cp ./restore.dump postgres:/tmp/restore.dump
docker compose exec -T postgres createdb -U ong restore_check
docker compose exec -T postgres pg_restore --exit-on-error --no-owner --no-acl -U ong -d restore_check /tmp/restore.dump
# ตรวจ: migration ล่าสุด + จำนวนบิล/ลูกค้า + บิลล่าสุดตรงกับที่เห็นในระบบ
docker compose exec -T postgres psql -U ong -d restore_check -c \
  "select (select count(*) from drizzle.__drizzle_migrations) migrations, (select count(*) from buy_receipt) receipts,
          (select count(*) from customer) customers, (select max(created_at) from buy_receipt) last_receipt"
# เสร็จแล้วลบทิ้ง
docker compose exec -T postgres dropdb -U ong restore_check
docker compose exec -T postgres rm /tmp/restore.dump && rm ./restore.dump
```

### กู้จริง (database เสีย)

**ข้อมูลที่หาย (RPO):** บิลที่บันทึกหลัง dump คืนล่าสุดหายจาก database — ไม่เกิน ~24 ชั่วโมง (นานกว่านั้นถ้ารอบคืนก่อนล้ม) · PDF ใบรับซื้อของบิลเหล่านั้นยังอยู่ใน `Media` เป็นหลักฐานภาษี · บิลที่ยังไม่มี PDF ตอนเกิดเหตุ (งาน PDF ค้าง/ล้ม) ไม่มีร่องรอยใน `Media` — ต้องตรวจจากใบที่ออกให้ลูกค้าแล้วของแต่ละสาขา

**เลขที่ใบรับซื้อต้องไม่ซ้ำ:** dump มีตัวนับ (`doc_sequence`) ของตอน dump — ถ้าเปิดรับบิลเลย บิลถัดไปได้เลขที่ออกไปแล้วหลัง dump (เช่น dump มีถึง RC6910-0031 แต่ออกไปถึง 0045 แล้ว → บิลใหม่ได้ 0032 ซ้ำ) · ขั้น 6 ยกตัวนับจาก PDF ใน `Media` ก่อนเปิดรับบิลเสมอ

**ห้าม restore ทับ database เดิม** (`--clean` เหลือ object ที่ไม่อยู่ใน dump ไว้ และทำลายหลักฐาน) — restore ลง database ใหม่ แล้วสลับชื่อ · ซ้อมขั้นตอนนี้ครบแล้วบน Postgres 18 + RustFS ในเครื่อง (ตัวนับ 31 ใน dump → 45 จาก PDF · บิลถัดไป RC6910-0046) · **ยังไม่ได้ซ้อมบน Railway**

1. หยุดรับบิลทุกสาขา · จดเวลา
2. เตรียม shell (ค่าอยู่ใน shell เท่านั้น): URL จาก `railway variable list --service Postgres --kv` → `DATABASE_PUBLIC_URL` (TCP proxy แบบเดียวกับ `railway connect Postgres`) แล้วเปลี่ยนแค่ชื่อ database ท้าย URL · rclone ตาม "ตั้ง rclone บนเครื่อง" · รันจาก root ของ repo

```bash
export ADMIN_URL=".../postgres" BROKEN_URL=".../railway" RESTORE_URL=".../railway_restore"
pg() { docker run --rm -i -v "$PWD:/w" -w /w postgres:18-alpine "$@"; }   # pg_dump/pg_restore/psql รุ่น 18
```

3. เก็บหลักฐาน — dump database ที่เสียไว้ก่อน (ส่วนที่อ่านไม่ได้ให้จดไว้ แล้วทำต่อ)

```bash
pg pg_dump -Fc --dbname="$BROKEN_URL" --file=/w/incident-<UTC>.dump
```

4. ตัดการเชื่อมต่อ database ที่เสีย แล้วสร้าง database ใหม่ — Office จะ error จนถึงขั้น 9 (ตั้งใจ) · งาน PDF ที่อ่าน database ไม่ได้จะหยุดเขียน `Media` ด้วย

```bash
pg psql -X -v ON_ERROR_STOP=1 "$ADMIN_URL" <<'SQL'
ALTER DATABASE railway WITH ALLOW_CONNECTIONS false;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'railway' AND pid <> pg_backend_pid();
CREATE DATABASE railway_restore;
SQL
```

5. restore dump คืนล่าสุด (เลือก/ดาวน์โหลดเป็น `./restore.dump` ตาม "กู้คืน database" ด้านบน) ลง database ใหม่

```bash
pg pg_restore --exit-on-error --no-owner --no-acl --dbname="$RESTORE_URL" /w/restore.dump
```

6. ยกตัวนับเลขที่เอกสารจากรายชื่อ PDF ใน `Media` — รอ 1–2 นาทีหลังขั้น 4 ให้ PDF ที่กำลังอัปโหลดเสร็จก่อน · สคริปต์อ่านรายชื่ออย่างเดียว ไม่แตะ `Media` · SQL ยกตัวนับอย่างเดียว (ไม่ลด) รันซ้ำได้ · key ที่อ่านไม่ออก หรือรหัสสาขาที่ไม่มีใน database = หยุดทั้งไฟล์ ไม่มีอะไรเปลี่ยน

```bash
rclone lsf -R --files-only "media:$S3_BUCKET" > media-keys.txt
bash services/backup/restore-doc-counters.sh < media-keys.txt > raise-counters.sql
pg psql -X -v ON_ERROR_STOP=1 "$RESTORE_URL" < raise-counters.sql
```

ผลที่พิมพ์: (1) `branch | period | media_max | counter` — counter ต้อง ≥ media_max ทุกแถว (ไม่งั้น SQL หยุดเอง) (2) `missing_from_database` — เลขที่มี PDF แต่ไม่มีใน database = บิลที่หาย → เก็บรายการไว้ส่งบัญชี
`Media` หายด้วย → ใช้รายชื่อจากสำเนาแทน (`rclone lsf -R --files-only "backup:$BACKUP_S3_BUCKET/production/files"`) แต่สำเนาช้ากว่าได้ถึงหนึ่งคืน — ตัวนับอาจต่ำไป ต้องตรวจกับใบจริงตามขั้น 7

7. ถามทุกสาขา: มีใบที่ออกให้ลูกค้าแล้วแต่เลขสูงกว่าที่ขั้น 6 เห็นไหม → ยกตัวนับเองทีละสาขา/งวด (ขึ้นอย่างเดียว) · ตัวอย่าง: สาขา 00000 งวด 6910 ออกถึงเลข 52 แล้ว

```bash
pg psql -X -v ON_ERROR_STOP=1 "$RESTORE_URL" <<'SQL'
INSERT INTO doc_sequence AS s (branch_id, prefix, period, last_no)
SELECT id, 'RC', '6910', 52 FROM branch WHERE code = '00000'
ON CONFLICT (branch_id, prefix, period) DO UPDATE SET last_no = GREATEST(s.last_no, EXCLUDED.last_no);
SQL
```

8. ตรวจ `railway_restore` แบบเดียวกับการซ้อม (migration · จำนวนบิล · บิลล่าสุด) และดูเลขถัดไปโดย**ไม่ใช้เลข** — ห้ามเรียก `next_doc_no()` ตรวจ (เรียกแล้วเลขถูกใช้ไปหนึ่งเลข)

```bash
pg psql -X "$RESTORE_URL" -c \
  "SELECT b.code, s.period, s.last_no + 1 AS next_no FROM doc_sequence s JOIN branch b ON b.id = s.branch_id ORDER BY 1, 2"
```

9. สลับชื่อ — ไม่มีอะไรถูกลบ: database ที่เสียเก็บไว้เป็นหลักฐาน (ต่อไม่ได้จนกว่าจะ `ALLOW_CONNECTIONS true`) · `DATABASE_URL` ของ Office ไม่เปลี่ยน (ชื่อเดิม `railway`) · Office ต่อใหม่เอง — ถ้ายัง error ให้กด Redeploy ของ `Office` ใน dashboard · ต้องไม่มี session ใดค้างอยู่ใน `railway_restore`

```bash
pg psql -X -v ON_ERROR_STOP=1 "$ADMIN_URL" <<'SQL'
ALTER DATABASE railway RENAME TO railway_broken_<yyyymmdd>;
ALTER DATABASE railway_restore RENAME TO railway;
SQL
```

10. เปิดรับบิล · **บิลที่หาย (รายการจากขั้น 6–7) ให้ฝ่ายบัญชีตัดสินว่าจะบันทึกอย่างไร** — ระบบนี้ไม่มีนโยบายให้ · ห้ามบันทึกซ้ำหรือแก้เลขเอง · PDF ของบิลเหล่านั้นใน `Media` ห้ามลบ (บิลใหม่ที่ชน key เดิม ระบบไม่เขียนทับและ mark PDF invalid — `apps/api/src/services/receiptPdf.ts`) · ลบไฟล์ dump/รายชื่อบนเครื่องเมื่อเสร็จ (มีเลขบัตรเต็ม)

### กู้คืนไฟล์

`copy` กลับเข้า `Media` — `--immutable` ไม่เขียนทับไฟล์ที่ยังอยู่ · ดู `--dry-run` ก่อนเสมอ (ทดสอบแล้ว: ไฟล์ที่ถูกลบกลับมาครบ sha256 ตรงกับ metadata)

```bash
rclone copy "backup:$BACKUP_S3_BUCKET/production/files" "media:$S3_BUCKET" --immutable --metadata --dry-run
rclone copy "backup:$BACKUP_S3_BUCKET/production/files" "media:$S3_BUCKET" --immutable --metadata
rclone lsjson --metadata "media:$S3_BUCKET/receipts/<สาขา>/<เลขที่>.pdf"   # metadata sha256
rclone hashsum sha256 --download "media:$S3_BUCKET/receipts/<สาขา>/<เลขที่>.pdf"  # ต้องตรงกัน
```

### ไฟล์ใน Media ถูกเขียนทับ

log: `ERROR : <key>: Source and destination exist but do not match: immutable file modified` (บางครั้งมี `Timestamp mismatch between immutable objects` ก่อน) แล้ว `files copy failed (exit 6)` · บรรทัดสรุป `database: ok (…) · files: FAILED (exit 6)` — database ยังสำรองตามปกติ แต่ส่วน files จะ fail ทุกคืนจนกว่าจะแก้

- แอปไม่เคยเขียนทับไฟล์ใน `Media`: รูปลูกค้าได้ key ใหม่ (UUID) ทุกครั้งที่อัปโหลด (`apps/api/src/services/customers.ts`) · PDF ใบรับซื้อ/สำเนาบัตรเขียนครั้งเดียว (`putImmutable`) — เกิดได้จากคนอัปโหลด/แก้ไฟล์เองเท่านั้น (console · rclone) · **เขียนทับด้วย byte เดิมก็ fail** (เวลาแก้ไขเปลี่ยน — ทดสอบแล้ว)
- ใบรับซื้อ/สำเนาบัตรเป็นเอกสารภาษี — หาให้ได้ว่าใครแก้ เมื่อไร เพราะอะไร ก่อนทำอะไรต่อ · เทียบฉบับปัจจุบันกับฉบับที่สำรองไว้ก่อนถูกแก้:

```bash
rclone lsjson --metadata "media:$S3_BUCKET/<key>"                                   # metadata sha256 ตอนแอปเขียน
rclone hashsum sha256 --download "media:$S3_BUCKET/<key>"                            # ฉบับปัจจุบัน
rclone hashsum sha256 --download "backup:$BACKUP_S3_BUCKET/production/files/<key>"   # ฉบับที่สำรองไว้
```

- ให้ backup เดินต่อโดยไม่ทิ้งฉบับเดิม: ย้ายสำเนาเดิมไป `files-conflicts/<เวลา UTC>/` (ไม่มีการ prune) แล้วรอบถัดไปจะ copy ไฟล์ปัจจุบันของ `Media` มาแทน (ทดสอบแล้ว: ฉบับเดิมพร้อม metadata อยู่ครบ · รอบถัดไปผ่าน)

```bash
rclone moveto "backup:$BACKUP_S3_BUCKET/production/files/<key>" \
  "backup:$BACKUP_S3_BUCKET/production/files-conflicts/<UTC>/<key>"
```

- ฉบับใน `Media` ผิดและฉบับเดิมถูก → ตัดสินกับบัญชีก่อนนำฉบับเดิมกลับเข้า `Media` (ห้ามเขียนทับเองโดยไม่มีบันทึก)

### dump เล็กลงผิดปกติ

log: `size guard: … less than 50% of the previous dump …` หรือ `refusing to delete …` แล้ว `dump size check failed — nothing pruned` · dump คืนนั้นอัปโหลดแล้ว แต่ไม่มีอะไรถูกลบ และ run จะ fail ทุกคืนจนกว่าจะแก้

- **production = เหตุผิดปกติจนกว่าจะพิสูจน์ได้ว่าไม่ใช่** — ตรวจในระบบว่าบิล/ลูกค้าของเมื่อวานยังอยู่ไหม · ข้อมูลหาย → ทำตาม "กู้จริง" ด้านบน · **อย่าย้าย/ลบ dump ใด ๆ** ระหว่างตรวจ
- ตั้งใจให้เล็กลงจริง (เช่น ล้างข้อมูลทดสอบใน staging): ย้าย dump เก่าที่ใหญ่กว่าไปเก็บแยก — `postgres-archive/` ไม่มีการ prune และ `rclone move` ภายใน bucket ไม่ทำให้ไฟล์หาย (ทดสอบแล้ว: รอบถัดไปผ่าน)

```bash
# เว้น dump ใหม่ (ตัวที่ log บอก) ไว้ใน postgres/ — ที่เหลือไป postgres-archive/<เวลา UTC ตอนย้าย>/
rclone move "backup:$BACKUP_S3_BUCKET/staging/postgres/" "backup:$BACKUP_S3_BUCKET/staging/postgres-archive/<UTC>/" \
  --exclude "staging-<UTC ของ dump ใหม่>.dump" --dry-run
# ดูรายการแล้วรันซ้ำโดยไม่ใส่ --dry-run
```

### ต่อสำเนานอก Railway (อนาคต)

เปลี่ยนปลายทางได้โดยไม่แก้สคริปต์: ใน `railway.ts` ของ `Nightly Backup` แทน `s3Env("BACKUP_S3_", backupBucket)` ด้วยค่าของ R2/B2 — `BACKUP_S3_PROVIDER` (`Cloudflare` / `Other`) · `BACKUP_S3_ENDPOINT` `_REGION` `_BUCKET` ค่าธรรมดา · `BACKUP_S3_ACCESS_KEY` / `_SECRET_KEY` เป็นค่า sealed แบบ `secret()` (key ของ B2 สั้นกว่า 32 ตัวอักษร — ต้องมี helper ที่ไม่บังคับความยาว) · ใช้ bucket แยกต่อ environment และเปิด object lock/bucket lock (ระยะ ≤ `BACKUP_KEEP_DAILY` วัน ไม่งั้น prune ลบไม่ได้แล้ว run fail) กัน key หลุดแล้วถูกลบ

### ทดสอบบนเครื่อง

- `pnpm test` รวม `services/backup/backup.test.ts` — ชื่อไฟล์ การเลือก dump ที่ลบ การตรวจขนาด และลำดับงานของ `backup.sh` กับคำสั่งปลอมใน PATH (ไม่ต้องมี Postgres/S3)
- `services/backup/restore-doc-counters.test.ts` — อ่าน key และรัน SQL ที่ได้ด้วย `psql` กับ database ที่ migrate + seed จริง (ยกตัวนับ · ไม่ลด · รันซ้ำได้ · รหัสสาขาไม่รู้จัก = หยุด · `next_doc_no()` ต่อจากเลขสูงสุด) — ต้องมี `psql` + Postgres ของ compose · ไม่มีข้าม (CI ต้องมี)
- end-to-end: build `services/backup` แล้วรันกับ Postgres 18 + RustFS ของ compose (ตั้ง `S3_*`/`BACKUP_S3_*` ชี้ `http://s3:9000` · `…_FORCE_PATH_STYLE=true` · สร้าง bucket ปลายทางก่อน · ต่อ network ของ compose)

## บัญชีพนักงาน

ไม่มีสมัครเอง (ปิด sign-up) — สร้างผ่านสคริปต์ใน image ของ `Office` · รหัสผ่านส่งทาง stdin (ไม่ค้างใน history) · ไม่ส่ง = สุ่มแล้วพิมพ์ครั้งเดียว

```bash
railway ssh --service Office -- sh -c 'node dist/create-user.js --email staff1@ong.co.th --name "ชื่อ" --role staff --branch 00000'
# role: staff · manager · accounting · admin · --allow 00001,00002 = สาขาเพิ่ม · --view-all = เห็นทุกสาขา
```

`railway ssh` ต้องลงทะเบียน SSH key ก่อน (`railway ssh keys add`)

## เลขที่ใบรับซื้อต่อจากระบบเดิม (PHP)

ค่าเริ่มต้น: ระบบใหม่เริ่มนับ `RC<yy><mm>-0001` เอง แยกตามสาขาและเดือน (ปี พ.ศ. 2 หลัก + เดือน) — ยังรอเจ้าของตัดสิน (spec §12 ข้อ 11)
ถ้าเลือกนับต่อจากระบบเดิม: ตั้งตัวนับของงวดนั้น **ก่อนเปิดบิลแรกของงวดในระบบใหม่** · `last_no` = เลข running ใบสุดท้ายของระบบเดิมในเดือนนั้น → ใบถัดไปได้ `last_no + 1`

```sql
-- railway connect Postgres (environment ที่ link อยู่) · ตัวอย่าง: สาขา 00000 · ต.ค. 2569 · ใบสุดท้ายของระบบเดิม = 123
INSERT INTO doc_sequence (branch_id, prefix, period, last_no)
SELECT id, 'RC', '6910', 123 FROM branch WHERE code = '00000';
-- ตรวจ: ต้องได้ 1 แถว last_no = 123
SELECT b.code, s.prefix, s.period, s.last_no FROM doc_sequence s JOIN branch b ON b.id = s.branch_id;
```

- `INSERT` ไม่มี `ON CONFLICT` โดยตั้งใจ — ถ้าขึ้น `duplicate key` แปลว่างวดนั้นออกเลขในระบบใหม่ไปแล้ว **ห้าม UPDATE `last_no` ย้อนหรือข้าม** (เลขชนกับบิลที่มีอยู่ = บันทึกไม่ได้ · เลขกระโดด = เอกสารภาษีขาดช่วง) ให้ปรึกษาบัญชีก่อน
- ทำทีละสาขา/ทีละงวด · ตัวนับถูกแก้ผ่าน `next_doc_no()` ในทรานแซกชันของการบันทึกบิลเท่านั้น (บิลที่บันทึกไม่สำเร็จคืนเลข ไม่มีเลขหาย)

## หมุนค่าลับ

export `RAILWAY_SET_*` ค่าใหม่แล้ว `pnpm railway:apply` — ไม่ export = `preserve()` คงค่าเดิม
`RAILWAY_SET_GOTENBERG_PASSWORD` ใช้ทั้งใน `PDF (Gotenberg)` และ `Office` — หมุนในการ apply ครั้งเดียวจึงตรงกันเสมอ

## production

ตั้งแล้ว 28 ก.ย. — `railway link --environment production` แล้วทำขั้น 4–5 ด้วยค่าลับชุดใหม่ (ค่า sealed ไม่ถูกคัดลอกข้าม environment)

เรื่องที่เจอตอนตั้ง production (แก้แล้ว แต่ต้องรู้ไว้):

- **IaC สร้าง bucket ใน environment ที่สองไม่ได้** — apply ขึ้น ✓ แต่ไม่มี bucket · แก้ด้วย API `environmentPatchCommit` ใส่ `buckets.<bucket id> = { region: "sin", isCreated: true }` แล้ว plan กลับมา up to date · **bucket `Backup` เจอแบบเดียวกันได้** ตอน apply ใน production ครั้งแรก — ตรวจทุกครั้ง
- **Postgres ของ production ใช้ volume ชื่อ `postgres-volume` ซ้ำกับ instance ใน staging ที่ถูกตั้งลบ** (29 ก.ย.) · API แสดงว่าตั้งลบเฉพาะ instance ของ staging แต่เอกสารไม่ยืนยัน → **เจ้าของบัญชีกด restore ในอีเมล "volume deleted" ของ `postgres-volume`** กันไว้ก่อน
- **ชื่อ service/bucket ผูกกับ IaC** — เปลี่ยนชื่อใน dashboard แล้วต้องแก้ค่าคงที่ใน `railway.ts` (`APP_SERVICE` `PDF_SERVICE` `BUCKET`) ก่อน apply ครั้งถัดไป ไม่งั้น plan จะสร้างใหม่แล้ว **ลบตัวเดิม** · Railway แก้ reference ใน variable ให้เองตอนเปลี่ยนชื่อ
- **deploy รออนุมัติ (NEEDS_APPROVAL)** — push จากบัญชี GitHub ที่ไม่ผูกกับบัญชี Railway ที่เป็นสมาชิก project (เช่น `danglebz`) Railway จะไม่ deploy เองจนกว่าจะกด Approve · แก้ถาวร: สมัคร/ผูก Railway ด้วย GitHub นั้นแล้วเชิญเข้า workspace · ตอนนี้ promote ด้วยบัญชี GitHub ของเจ้าของ (`tanasatha-mahathep` ผูกกับ Railway แล้ว) จึงไม่ต้องอนุมัติ
- ค่าที่ไม่ได้ประกาศใน `railway.ts` จะถูกล้างตอน apply (เช่น pre-deploy timeout) — ประกาศทุกค่าที่ต้องการไว้ในไฟล์
  production ไม่ seed อัตโนมัติ — seed เองหลังได้รหัสสาขา 5 หลักจริง (`railway ssh --service Office -- node dist/seed.js`)

# ONG หลอมทอง — ระบบซื้อเข้าหน้าร้าน + สมาชิก

TypeScript ล้วน · Vite + TanStack (web) · Hono (api) · Drizzle + Postgres · Gotenberg (PDF) · Railway

สเปกและผลสำรวจระบบเดิมอยู่ที่ `../Work_2026-09-27/` (นอก repo) — อ่าน `05-spec-vite-tanstack.md` ก่อนเขียนโค้ด

## รันบนเครื่อง

`make` (หรือ `make help`) แสดงคำสั่งทั้งหมด — ห่อ pnpm · docker compose · railway · gh ไว้ที่เดียว และโหลด `.env` ให้คำสั่งที่ต้องใช้

```bash
make setup               # install · .env · postgres/gotenberg/minio · migrate · seed
make dev                 # web http://localhost:5173 (proxy /api → api :8787)
make check               # lint · format · typecheck · test · build — ชุดเดียวกับ CI
```

```bash
make branch NAME=feat/xxx   # feature branch จาก dev
make pr                     # push + เปิด PR เข้า dev
make merge PR=12            # รอ CI แล้ว merge แบบ rebase
make promote TO=testing     # dev → testing → staging → main (main ต้อง CONFIRM=yes)
make railway-plan ENV=staging
```

## Commit / release

Conventional Commits (ภาษาอังกฤษ) บังคับด้วย commitlint + husky (`pre-commit` = lint-staged: eslint · prettier · sort-package-json)
branch: `dev` (พัฒนา) → `testing` (ทดสอบ) → `staging` (ก่อนขึ้นจริง · Railway staging) → `main` (production + release)
งานทุกชิ้นเข้า `dev` ผ่าน PR แบบ **rebase** เท่านั้น (feature branch → PR → CI ผ่าน → Rebase and merge) — repo ตั้งให้ merge ได้แบบ rebase อย่างเดียว (ลบ feature branch ด้วย `--delete-branch` ตอน merge · **ห้ามเปิด "Automatically delete head branches"** เพราะ PR promotion มี head เป็น `dev`/`testing` — ปิด PR แล้ว GitHub จะลบ branch ถาวรทิ้ง) · branch protection ต้องใช้ GitHub Pro (repo private) จึงยังบังคับ "ห้าม push ตรง" ด้วยระบบไม่ได้
promote ทีละขั้น: เปิด PR promotion (เช่น `testing ← dev`) ให้เห็น diff + CI แล้ว fast-forward ด้วย `git push origin dev:testing` — SHA เดิมทุก branch · PR ขึ้นว่า merged เอง · **ห้ามกด Rebase and merge กับ PR promotion** (จะได้ SHA ใหม่ แล้ว branch แยกกัน)
push เข้า `main` → CI (commitlint · lint · format · typecheck · test · build) → semantic-release ออก tag `vX.Y.Z` + [GitHub Release](https://github.com/tanasatha-mahathep/ong-lom-thong/releases) + อัปเดต [CHANGELOG.md](CHANGELOG.md) → ดึง `staging` `testing` `dev` ตาม `main` ให้อัตโนมัติ
dependency อัปเดตผ่าน [Renovate](renovate.json) — PR ไปที่ `dev` ทุกวันจันทร์ · major ต้องอนุมัติใน Dependency Dashboard

## โครง

```
apps/web        Vite + React · TanStack Router/Query/Form/Table · Tailwind
apps/api        Hono — REST · เสิร์ฟ web build ที่ / (origin เดียว)
packages/core   @ong/core — ตรรกะเงินทั้งหมด (decimal.js) + เทสต์
packages/db     Drizzle schema · migrations · plpgsql (sql/functions.sql)
services/gotenberg  image Gotenberg + ฟอนต์ Sarabun
```

## Railway (project `Ong Lom Thong` · region Singapore)

โครงสร้างทั้งหมดอยู่ใน [`.railway/railway.ts`](.railway/railway.ts) (Infrastructure as Code) — วิธีตั้งครั้งแรก · ค่าลับ · ตรวจหลัง deploy: [`.railway/README.md`](.railway/README.md)

| resource  | ที่มา                                       | หมายเหตุ                                                  |
| --------- | ------------------------------------------- | --------------------------------------------------------- |
| api       | `apps/api/Dockerfile` (context = root repo) | เสิร์ฟ web + REST · pre-deploy migrate · public domain    |
| gotenberg | `services/gotenberg`                        | private only · basic auth · `PORT=3000`                   |
| Postgres  | Railway Postgres 18                         | `DATABASE_URL` reference                                  |
| files     | Railway Bucket (`sin`)                      | `S3_*` reference · private · ไม่มี versioning/object lock |
| cron      | ยังไม่ทำ                                    | `pg_dump` + `rclone` → R2/B2 ทุกคืน (ภาคบังคับ)           |

environment บน Railway ใช้ชื่อเดียวกับ branch (`dev` `testing` `staging` · `production` ← `main`) — ตอนนี้ตั้งแค่ staging + production · Railway รอ CI ผ่านก่อน deploy

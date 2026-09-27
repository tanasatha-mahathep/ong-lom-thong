# ONG หลอมทอง — ระบบซื้อเข้าหน้าร้าน + สมาชิก

TypeScript ล้วน · Vite + TanStack (web) · Hono (api) · Drizzle + Postgres · Gotenberg (PDF) · Railway

สเปกและผลสำรวจระบบเดิมอยู่ที่ `../Work_2026-09-27/` (นอก repo) — อ่าน `05-spec-vite-tanstack.md` ก่อนเขียนโค้ด

## รันบนเครื่อง

```bash
pnpm install
cp .env.example .env
pnpm infra:up            # postgres 18 · gotenberg (+ฟอนต์ Sarabun) · minio (S3 local)
pnpm db:migrate && pnpm db:seed
pnpm dev                 # web http://localhost:5173 (proxy /api → api :8787)
```

```bash
pnpm test                # vitest ทุกแพ็กเกจ (projects) — ตรรกะเงินใน packages/core ต้องเขียวเสมอ
pnpm typecheck
pnpm lint                # eslint (type-checked) · lint:fix
pnpm format              # prettier · format:check
pnpm build               # web → apps/web/dist · api → apps/api/dist
```

## Commit / release

Conventional Commits (ภาษาอังกฤษ) บังคับด้วย commitlint + husky (`pre-commit` = lint-staged: eslint · prettier · sort-package-json)
งานลง branch `staging` (Railway staging) → ทดสอบผ่าน → promote เข้า `main` แบบ fast-forward (`git push origin staging:main`)
push เข้า `main` → CI (commitlint · lint · format · typecheck · test · build) → semantic-release ออก tag `vX.Y.Z` + [GitHub Release](https://github.com/tanasatha-mahathep/ong-lom-thong/releases) + อัปเดต [CHANGELOG.md](CHANGELOG.md) → ดึง `staging` ตาม `main` ให้อัตโนมัติ
dependency อัปเดตผ่าน [Renovate](renovate.json) — PR ไปที่ `staging` ทุกวันจันทร์ · major ต้องอนุมัติใน Dependency Dashboard

## โครง

```
apps/web        Vite + React · TanStack Router/Query/Form/Table · Tailwind
apps/api        Hono — REST · เสิร์ฟ web build ที่ / (origin เดียว)
packages/core   @ong/core — ตรรกะเงินทั้งหมด (decimal.js) + เทสต์
packages/db     Drizzle schema · migrations · plpgsql (sql/functions.sql)
services/gotenberg  image Gotenberg + ฟอนต์ Sarabun
```

## Railway (project `ong-pos` · region Singapore)

โครงสร้างทั้งหมดอยู่ใน [`.railway/railway.ts`](.railway/railway.ts) (Infrastructure as Code) — วิธีตั้งครั้งแรก · ค่าลับ · ตรวจหลัง deploy: [`.railway/README.md`](.railway/README.md)

| resource  | ที่มา                                       | หมายเหตุ                                                  |
| --------- | ------------------------------------------- | --------------------------------------------------------- |
| api       | `apps/api/Dockerfile` (context = root repo) | เสิร์ฟ web + REST · pre-deploy migrate · public domain    |
| gotenberg | `services/gotenberg`                        | private only · basic auth · `PORT=3000`                   |
| Postgres  | Railway Postgres 18                         | `DATABASE_URL` reference                                  |
| files     | Railway Bucket (`sin`)                      | `S3_*` reference · private · ไม่มี versioning/object lock |
| cron      | ยังไม่ทำ                                    | `pg_dump` + `rclone` → R2/B2 ทุกคืน (ภาคบังคับ)           |

branch `staging` → environment staging · `main` → production · Railway รอ CI ผ่านก่อน deploy

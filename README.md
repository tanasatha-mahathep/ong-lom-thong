# ONG หลอมทอง — ระบบซื้อเข้าหน้าร้าน + สมาชิก

TypeScript ล้วน · Vite + TanStack (web) · Hono (api) · Drizzle + Postgres · Gotenberg (PDF) · Railway

สเปกและผลสำรวจระบบเดิมอยู่ที่ `../Work_2026-09-27/` (นอก repo) — อ่าน `05-spec-vite-tanstack.md` ก่อนเขียนโค้ด

## รันบนเครื่อง

```bash
pnpm install
cp .env.example .env
pnpm infra:up            # postgres · gotenberg (+ฟอนต์ Sarabun) · minio (S3 local)
pnpm db:migrate && pnpm db:seed
pnpm dev                 # web http://localhost:5173 (proxy /api → api :8787)
```

```bash
pnpm test                # vitest — ตรรกะเงินใน packages/core ต้องเขียวเสมอ
pnpm typecheck
pnpm build               # web → apps/web/dist · api → apps/api/dist
```

## โครง

```
apps/web        Vite + React · TanStack Router/Query/Form/Table · Tailwind
apps/api        Hono — REST · เสิร์ฟ web build ที่ / (origin เดียว)
packages/core   @ong/core — ตรรกะเงินทั้งหมด (decimal.js) + เทสต์
packages/db     Drizzle schema · migrations · plpgsql (sql/functions.sql)
services/gotenberg  image Gotenberg + ฟอนต์ Sarabun
```

## Railway (project เดียว · region Singapore)

| service | root directory | config |
|---|---|---|
| api | `/` (repo root) | `railway.json` → `apps/api/Dockerfile` · env จาก `.env.example` |
| gotenberg | `services/gotenberg` | `services/gotenberg/railway.json` · private only |
| postgres | Railway Postgres | `DATABASE_URL` reference |
| bucket | Railway Object Storage | `S3_*` env · private |
| cron | root, cron schedule | `pg_dump` + `rclone` → R2/B2 ทุกคืน |

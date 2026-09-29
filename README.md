# ONG หลอมทอง — ระบบซื้อเข้าหน้าร้าน + สมาชิก

TypeScript ล้วน · Vite + TanStack (web) · Hono (api) · Drizzle + Postgres · Gotenberg (PDF) · Railway

สเปกและผลสำรวจระบบเดิมอยู่ที่ `../Work_2026-09-27/` (นอก repo) — อ่าน `05-spec-vite-tanstack.md` ก่อนเขียนโค้ด

## รันบนเครื่อง

`make` (หรือ `make help`) แสดงคำสั่งทั้งหมด — ห่อ pnpm · docker compose · railway · gh ไว้ที่เดียว และโหลด `.env` ให้คำสั่งที่ต้องใช้

```bash
make setup               # install · .env · postgres/gotenberg/s3 (RustFS) · migrate · seed
make dev                 # web http://localhost:5173 (proxy /api → api :8787)
WEB_PORT=5181 API_PORT=8791 make dev   # หลายชุดพร้อมกัน (เช่น worktree) — ตั้ง PORT=8791 · BETTER_AUTH_URL=http://localhost:5181 ใน .env
make check               # lint · format · typecheck · test ทุก project · coverage ของ core · build · งบ bundle — ชุดเดียวกับ job check ใน CI
```

เบราว์เซอร์ขั้นต่ำของหน้าเว็บ: Chrome/Edge 111 · Firefox 128 · Safari 16.4 (Tailwind 4 และ `Intl.NumberFormat` ที่รับข้อความทศนิยม — ตั้งไว้ใน `build.target` ของ `apps/web/vite.config.ts`)

```bash
make branch NAME=feat/xxx   # feature branch จาก dev
make pr                     # push + เปิด PR เข้า dev
make merge PR=12            # รอ CI แล้ว merge แบบ merge commit
make promote TO=testing     # dev → testing → staging → main (main ต้อง CONFIRM=yes)
make railway-plan ENV=staging
```

## การทดสอบและ CI

| ชั้น                    | อยู่ที่                                                                                                                           | ในเครื่อง                                    | ต้องมี      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------- |
| unit + integration      | `packages/*` · `apps/*` (vitest · Postgres จริง ต่อไฟล์เทสต์)                                                                     | `make test`                                  | Postgres    |
| coverage โมดูลเงิน/ภาษี | `vitest.config.ts` — 100% ต่อไฟล์ใน `packages/core` จากเทสต์หน่วย                                                                 | `make test-coverage`                         | —           |
| สัญญา API               | `apps/api/src/app.contract.test.ts` — ทุก route ที่ลงทะเบียน: 401 · CSRF 403 · 404 ไม่ใช่ 500 · มาสก์เลขบัตร · no-store           | `make test`                                  | Postgres    |
| migration               | `scripts/ci/db-verify.sh` — drift · append-only · อัปเกรดจาก tag ของ production · convergence · `functions.sql` · expand–contract | `make db-verify`                             | Postgres    |
| image                   | `scripts/ci/image-smoke.sh` — Dockerfile ที่ Railway ใช้: boot · pre-deploy ซ้ำได้ · header · SIGTERM · access log                | `make smoke`                                 | Docker      |
| e2e                     | `tests/e2e` (Playwright: smoke · api · pdf · ui) บน stack จริง                                                                    | `make e2e-up` → `make e2e` → `make e2e-down` | Docker      |
| ความปลอดภัย             | `scripts/ci/{ci-lint,secret-scan,sast,sca}.sh` — actionlint · zizmor · shellcheck · gitleaks · Semgrep CE · OSV-Scanner           | `make scan` · `make sca` · `make security`   | Docker + jq |
| TestSprite (advisory)   | `tests/testsprite` — probe อ่านอย่างเดียว · ห้ามชี้ production ([README](tests/testsprite/README.md))                             | `make testsprite-probe URL=…`                | Python 3    |

**วงแหวนของ CI** ([ci.yml](.github/workflows/ci.yml)) — gate ที่ `make promote` และ Railway รอ อยู่ในไฟล์นี้ทั้งหมด

- **ring 0** — ทุก PR และ push: `check` · `scan` · `db-verify` · `backup-image` (รันขนานกัน)
- **ring 1** — push `testing` / `staging` / `main` และ `make ci-full` (workflow_dispatch บน branch ใดก็ได้): `image` (build ครั้งเดียว → smoke → SBOM CycloneDX → Trivy gate) → `e2e` บน image เดียวกัน · `sca`
- **ring 2** — [deploy-smoke.yml](.github/workflows/deploy-smoke.yml): Railway deploy สำเร็จ → Playwright `smoke` (อ่านอย่างเดียว) ยิงเว็บจริง · URL จาก repository variables `E2E_URL_STAGING` · `E2E_URL_PRODUCTION` (ไม่ตั้ง = ข้าม)
- **advisory** — [security.yml](.github/workflows/security.yml) ทุกวันจันทร์บน `main` · [testsprite.yml](.github/workflows/testsprite.yml) ทุกคืน (เงียบจนตั้ง `vars.TESTSPRITE_PROJECT_ID`) — ไม่ block promote
- repo private บน GitHub Free ใช้ CodeQL / dependency review / secret scanning ของ GitHub ไม่ได้ → ใช้ Semgrep CE · OSV-Scanner · gitleaks ใน container ปัก digest แทน · Dependabot alerts (ฟรี) เปิดอยู่ · ข้อยกเว้นทุกตัวต้องมีเหตุผล (และวันหมดอายุเมื่อเครื่องมือรองรับ)
- Docker VM ในเครื่องมีดิสก์จำกัด — build image ทีละตัว และลบ image ของตัวเองเมื่อเสร็จ

## Commit / release

Conventional Commits (ภาษาอังกฤษ) บังคับด้วย commitlint + husky (`pre-commit` = lint-staged: eslint · prettier · sort-package-json)
branch: `dev` (พัฒนา) → `testing` (ทดสอบ) → `staging` (ก่อนขึ้นจริง · Railway staging) → `main` (production + release)
งานทุกชิ้นเข้า `dev` ผ่าน PR แบบ **merge commit** เท่านั้น (feature branch → PR → CI ผ่าน → Create a merge commit) — repo ตั้งให้ merge ได้แบบ merge commit อย่างเดียว (ปิด rebase/squash · **ห้าม rebase** ทั้งตอน merge และตอนอัปเดต branch — ถ้าต้องเอา dev เข้ามาใช้ `git merge origin/dev` · ลบ feature branch ด้วย `--delete-branch` ตอน merge · **ห้ามเปิด "Automatically delete head branches"** เพราะ PR promotion มี head เป็น `dev`/`testing` — ปิด PR แล้ว GitHub จะลบ branch ถาวรทิ้ง) · branch protection ต้องใช้ GitHub Pro (repo private) จึงยังบังคับ "ห้าม push ตรง" ด้วยระบบไม่ได้
promote ทีละขั้นด้วย PR promotion (เช่น `testing ← dev`) → CI ผ่าน → `gh pr merge <n> --merge` (merge commit เป็นขั้น ๆ ไม่ fast-forward) · **ห้าม `--delete-branch` กับ PR promotion** (head คือ `dev`/`testing` — branch ยืนระยะ ไม่ใช่ feature branch) · ห้าม fast-forward / `git push origin dev:testing` · ห้ามข้ามขั้น · `make promote TO=testing|staging|main` ทำให้ครบขั้นตอน (main ต้อง `CONFIRM=yes`)
push เข้า `main` → CI ครบทุกวงแหวน (ดู [การทดสอบและ CI](#การทดสอบและ-ci)) → semantic-release ออก tag `vX.Y.Z` + [GitHub Release](https://github.com/tanasatha-mahathep/ong-lom-thong/releases) + อัปเดต [CHANGELOG.md](CHANGELOG.md) → merge `main` กลับเข้า `staging` → `testing` → `dev` ด้วย `--no-ff` ให้อัตโนมัติ (แต่ละ branch เป็น merge commit ของตัวเอง)
dependency อัปเดตผ่าน [Renovate](renovate.json) — PR ไปที่ `dev` ทุกวันจันทร์ · major ต้องอนุมัติใน Dependency Dashboard

## โครง

```
apps/web        Vite + React · TanStack Router/Query/Form/Table · Tailwind
apps/api        Hono — REST · เสิร์ฟ web build ที่ / (origin เดียว)
packages/core   @ong/core — ตรรกะเงินทั้งหมด (decimal.js) + เทสต์
packages/db     Drizzle schema · migrations · plpgsql (sql/functions.sql)
services/gotenberg  image Gotenberg + ฟอนต์ Sarabun
services/backup     cron สำรองข้อมูลรายคืน — pg_dump + rclone (bash) + เทสต์
```

## Railway (project `Ong Lom Thong` · region Singapore)

โครงสร้างทั้งหมดอยู่ใน [`.railway/railway.ts`](.railway/railway.ts) (Infrastructure as Code) — วิธีตั้งครั้งแรก · ค่าลับ · ตรวจหลัง deploy: [`.railway/README.md`](.railway/README.md)

| resource  | ที่มา                                        | หมายเหตุ                                                                                           |
| --------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| api       | `apps/api/Dockerfile` (context = root repo)  | เสิร์ฟ web + REST · pre-deploy migrate · public domain                                             |
| gotenberg | `services/gotenberg`                         | private only · basic auth · `PORT=3000`                                                            |
| Postgres  | Railway Postgres 18                          | `DATABASE_URL` reference                                                                           |
| files     | Railway Bucket (`sin`)                       | `S3_*` reference · private · ไม่มี versioning/object lock                                          |
| cron      | `services/backup` (service `Nightly Backup`) | ทุกคืน 02:17 น. · `pg_dump` + `rclone copy` → bucket `Backup` (Railway) · ยังไม่มีสำเนานอก Railway |
| Backup    | Railway Bucket (`sin`)                       | `BACKUP_S3_*` reference · private · dump 30 วัน + 12 เดือน · สำเนาไฟล์ไม่ลบ                        |

environment บน Railway ใช้ชื่อเดียวกับ branch (`dev` `testing` `staging` · `production` ← `main`) — ตอนนี้ตั้งแค่ staging + production · Railway รอ CI ผ่านก่อน deploy

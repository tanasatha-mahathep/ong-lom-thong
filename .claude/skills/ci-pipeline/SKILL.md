---
name: ci-pipeline
description: วงแหวน CI ของ repo ร้านทอง (PR/dev → testing → staging → main) — job ไหนรันที่ไหน วิธีเพิ่ม job ใน .github/workflows โดยไม่พัง make promote และ Railway gate ปัก action ด้วย SHA สิทธิ์ต่ำสุด ใช้ทุกครั้งที่แตะ .github/workflows, scripts/ci หรือ target CI ใน Makefile
---

# ci-pipeline

## วงแหวน

- **ring 0 — ทุก PR + push ทุก branch** (`ci.yml`, ขนานกัน): `check` (commitlint · lint · format · typecheck · test ทุก project · coverage gate ของ core · test ของตัวห่อ TestSprite · build · bundle budget) · `scan` (actionlint · zizmor · shellcheck · gitleaks · Semgrep CE — ไม่ติดตั้ง dependency ของ repo) · `db-verify` · `backup-image`
- **ring 1 — push `testing`/`staging`/`main` · `workflow_dispatch`** (`make ci-full` บน branch ใดก็ได้ก่อน merge): `image` (build Dockerfile ที่ Railway ใช้ครั้งเดียว → smoke → SBOM CycloneDX → Trivy gate → ส่ง tar ให้ e2e · Gotenberg: `scripts/ci/gotenberg-scan.sh` gate CRITICAL ที่มี fix · ผ่านทั้งคู่ → `scripts/ci/push-image.sh` push ghcr.io tag SHA + branch → `actions/attest` provenance + SBOM ลง registry · job เดียวที่มี `packages`/`id-token`/`attestations: write` · ตรวจ: `make verify-image REF=<sha>`) → `e2e` (Playwright บน stack จริงจาก image เดียวกัน ตรวจ image ID) · `sca` (OSV-Scanner บน lockfile — advisory ใหม่ออกได้ทุกวันแม้ SHA เดิม)
- **ring 2 — หลัง Railway deploy** (`deploy-smoke.yml`, `deployment_status` ของ `railway-app[bot]`): Playwright project `smoke` (อ่านอย่างเดียว) ยิงเว็บจริง · URL จาก repo variables `E2E_URL_STAGING` · `E2E_URL_PRODUCTION` (ไม่ตั้ง = ข้าม)
- **advisory** — `security.yml` (ทุกวันจันทร์บน `main` + dispatch · มี job `gotenberg-image` · fail → เปิด/คอมเมนต์ issue) · `codeql.yml` (PR → `dev` · push `dev`/`testing`/`staging`/`main` · ทุกพุธ + dispatch) · `dependency-review.yml` (ทุก PR) · `testsprite.yml` (ทุกคืน · เงียบจนตั้ง `vars.TESTSPRITE_PROJECT_ID`) — ไม่ block promote เพราะอยู่นอก `ci.yml`
- repo public (28 ก.ย. 2026) — GitHub code scanning (CodeQL) · dependency review ใช้ได้ฟรีแล้ว (secret scanning ของ GitHub เปิดเองใน repo settings) เสริม Semgrep CE · OSV-Scanner · gitleaks (defence in depth ไม่ใช่แทนที่) · Dependabot alerts (ฟรี) เปิดอยู่
- **release** — push `main` เท่านั้น · `needs` ทุก gate ของ ring 0 + ring 1 · ขั้น sync merge `main` กลับลงไปด้วย `--no-ff`

promote ทีละขั้นด้วย **merge commit** (`make promote` → PR promotion → CI ของ PR ผ่าน → `gh pr merge --merge` · **ห้าม `--delete-branch`** · ห้าม fast-forward / push ตรง) → ring 1 รันบน merge commit ของ branch ปลายทาง: เนื้อโค้ดเท่ากับต้นทางที่ผ่าน ring 0 แล้ว ring 1 จึงเป็นสัญญาณใหม่ · repo private บน GitHub Free = นาที Actions และ artifact 500 MB จำกัด → ของหนักอยู่ ring 1 เท่านั้น · ส่งต่อได้เฉพาะ image ของ api (~90 MB zipped · retention 1 วัน) — gotenberg (~1.7 GB) ให้ job ที่ใช้ build เอง

## กฎ

1. gate ที่ `make promote` และ Railway พึ่ง ต้องอยู่ใน `ci.yml` (`make promote` เช็ค `gh run list --workflow ci.yml --branch <from> --commit <sha>`) · workflow แยกได้เฉพาะงาน advisory/security
2. action ภายนอกปักด้วย commit SHA + คอมเมนต์ `# vX.Y.Z` — หา SHA: `gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq '.object.type + " " + .object.sha'` ถ้าได้ `tag` (annotated) ให้ตามต่อ `gh api repos/<owner>/<repo>/git/tags/<sha> --jq .object.sha` · docker image ปักด้วย digest
3. `permissions: contents: read` ระดับ workflow · เพิ่มสิทธิ์ราย job เท่าที่ใช้ · job ที่มีสิทธิ์เขียนห้ามใช้ cache
4. ค่า `github.event.*` / `inputs.*` ส่งผ่าน `env:` แล้วอ้าง `"$VAR"` — ห้ามใส่ `${{ }}` ใน `run:` (template injection)
5. `actions/checkout` ใส่ `persist-credentials: false` · ทุก job มี `timeout-minutes` · คง `concurrency` เดิม
6. ห้าม `continue-on-error` บน gate เงิน/สาขา/migration/secret — ใช้ได้เฉพาะงาน advisory (TestSprite) · `security.yml` ไม่ใช้ `continue-on-error`: แดงให้เห็นแต่ไม่ block promote เพราะอยู่นอก `ci.yml`
7. ผลที่คนต้องอ่าน → `$GITHUB_STEP_SUMMARY` · หลักฐาน (trace · report · SBOM) → `actions/upload-artifact` `retention-days: 14`
8. logic ยาวกว่า ~5 บรรทัด → `scripts/ci/<name>.sh` (bash · `set -euo pipefail` · รันในเครื่องได้เหมือน CI ผ่าน `make`) ไม่ฝังใน YAML
9. ก่อน commit: `make ci-lint` (actionlint + zizmor + shellcheck) และ `make check` ต้องผ่าน · ข้อยกเว้นของ scanner ทุกตัวต้องมีเหตุผล (+ วันหมดอายุ ≤ 90 วันเมื่อเครื่องมือรองรับ)
10. image ของเครื่องมือทุกตัวใน `scripts/ci` ปัก digest พร้อมคอมเมนต์ `# renovate: datasource=docker depName=…` บรรทัดก่อน — Renovate อัปเดตผ่าน customManagers ใน `renovate.json` · Trivy ใช้ `docker://aquasec/trivy@sha256:…` ไม่ใช้ trivy-action (tag ของชุดนั้นถูกเจาะ มี.ค. 2026 · GHSA-69fq-xp46-6x23)
11. เพิ่ม job/เปลี่ยนชื่อ job = อัปเดต `README.md` ส่วน CI และสกิลนี้ใน commit เดียวกัน

## ข้อห้ามของ repo

- ห้ามเปิด "Automatically delete head branches" · PR promotion merge ด้วย merge commit เท่านั้น ห้าม `--delete-branch` ห้าม rebase/squash/fast-forward
- Bash tool ของเครื่องนี้คือ zsh — ใส่ `${var}` เสมอก่อน `:` ตอนลองคำสั่งใน tool (script ใน `scripts/ci/` รันด้วย bash ไม่โดน)

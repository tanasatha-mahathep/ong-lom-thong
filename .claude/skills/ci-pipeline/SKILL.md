---
name: ci-pipeline
description: วงแหวน CI ของ repo ร้านทอง (PR/dev → testing → staging → main) — job ไหนรันที่ไหน วิธีเพิ่ม job ใน .github/workflows โดยไม่พัง make promote และ Railway gate ปัก action ด้วย SHA สิทธิ์ต่ำสุด ใช้ทุกครั้งที่แตะ .github/workflows, scripts/ci หรือ target CI ใน Makefile
---

# ci-pipeline

## วงแหวน

- **ring 0 — ทุก PR + push ทุก branch** (`ci.yml`): `check` (commitlint · lint · format · typecheck · test:coverage · build · bundle budget · workflow lint · secret scan) และ `db-verify` — เป้าหมาย < 5 นาที wall clock
- **ring 1 — push `testing`/`staging`/`main` · `workflow_dispatch` · PR ที่ติด label `full-ci`** (`ci.yml`): `image` (build Dockerfile ที่ Railway ใช้ → smoke → Trivy → SBOM) แล้ว `e2e` (Playwright บน stack จริงจาก image เดียวกัน)
- **ring 2 — หลัง Railway deploy** (`deploy-smoke.yml`, `deployment_status`): Playwright project `smoke` (อ่านอย่างเดียว) ยิงใส่ URL จริง
- **security** — `codeql.yml` (PR → dev · push dev · รายสัปดาห์) · `security.yml` (dependency-review บน PR · osv-scanner บน push testing+ และรายสัปดาห์)
- **release** — push `main` เท่านั้น (semantic-release + sync branch) — ห้ามแตะเว้นแต่ถูกสั่ง

promote เป็น fast-forward SHA เดิม → ring 1 ต้องให้**สัญญาณใหม่** ไม่ใช่รัน ring 0 ซ้ำ · repo เป็น private บน GitHub Free = นาที Actions จำกัด → ของหนักอยู่ ring 1 เท่านั้น

## กฎ

1. gate ที่ `make promote` และ Railway พึ่ง ต้องอยู่ใน `ci.yml` (`make promote` เช็ค `gh run list --workflow ci.yml --branch <from> --commit <sha>`) · workflow แยกได้เฉพาะงาน advisory/security
2. action ภายนอกปักด้วย commit SHA + คอมเมนต์ `# vX.Y.Z` — หา SHA: `gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq '.object.type + " " + .object.sha'` ถ้าได้ `tag` (annotated) ให้ตามต่อ `gh api repos/<owner>/<repo>/git/tags/<sha> --jq .object.sha` · docker image ปักด้วย digest
3. `permissions: contents: read` ระดับ workflow · เพิ่มสิทธิ์ราย job เท่าที่ใช้ · job ที่มีสิทธิ์เขียนห้ามใช้ cache
4. ค่า `github.event.*` / `inputs.*` ส่งผ่าน `env:` แล้วอ้าง `"$VAR"` — ห้ามใส่ `${{ }}` ใน `run:` (template injection)
5. `actions/checkout` ใส่ `persist-credentials: false` · ทุก job มี `timeout-minutes` · คง `concurrency` เดิม
6. ห้าม `continue-on-error` บน gate เงิน/สาขา/migration/secret — ใช้ได้เฉพาะงาน advisory (TestSprite · osv รายสัปดาห์)
7. ผลที่คนต้องอ่าน → `$GITHUB_STEP_SUMMARY` · หลักฐาน (trace · report · SBOM) → `actions/upload-artifact` `retention-days: 14`
8. logic ยาวกว่า ~5 บรรทัด → `scripts/ci/<name>.sh` (bash · `set -euo pipefail` · รันในเครื่องได้เหมือน CI ผ่าน `make`) ไม่ฝังใน YAML
9. ก่อน commit: `make ci-lint` (actionlint + zizmor) และ `make check` ต้องผ่าน
10. เพิ่ม job/เปลี่ยนชื่อ job = อัปเดต `README.md` ส่วน CI และสกิลนี้ใน commit เดียวกัน

## ข้อห้ามของ repo

- ห้ามเปิด "Automatically delete head branches" · ห้ามกดปุ่ม merge ใน PR promotion
- Bash tool ของเครื่องนี้คือ zsh — ใส่ `${var}` เสมอก่อน `:` ตอนลองคำสั่งใน tool (script ใน `scripts/ci/` รันด้วย bash ไม่โดน)

# ONG หลอมทอง — คำสั่งประจำวัน · `make` หรือ `make help` ดูรายการ
# เข้ากันได้กับ GNU make 3.81 ที่มากับ macOS (recipe ย่อหน้าด้วย tab)

SHELL := /bin/bash
.DEFAULT_GOAL := help
MAKEFLAGS += --no-print-directory

PROJECT   := Ong Lom Thong
ENV       ?= staging
SERVICE   ?= Office
API_IMAGE ?= ong-api:local
# แอปไม่มี dotenv loader — คำสั่งที่ต้องใช้ DATABASE_URL / BETTER_AUTH_* โหลด .env ผ่านตัวนี้
WITH_ENV  := set -a && . ./.env && set +a &&

.PHONY: help setup install dev infra-up infra-down infra-reset logs \
	db-migrate db-seed db-generate db-psql \
	check lint lint-fix format format-check typecheck test test-coverage test-watch build bundle-budget docker-api \
	scan ci-lint secret-scan sast sca security smoke e2e-up e2e e2e-down ci-full testsprite-probe testsprite-doctor \
	railway-link railway-plan railway-apply railway-logs railway-status \
	branch pr merge promote sync clean

help: ## แสดงคำสั่งทั้งหมด
	@awk 'BEGIN {FS = ":.*## "} /^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0, 5)} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

##@ เริ่มต้น
setup: install .env infra-up db-migrate db-seed ## ติดตั้งจนพร้อม dev: install · .env · infra · migrate · seed

install: ## ติดตั้ง dependency (เวอร์ชัน pnpm ตาม packageManager)
	pnpm install

.env:
	cp .env.example .env
	@echo "สร้าง .env จาก .env.example แล้ว"

##@ พัฒนา
dev: .env ## web :5173 + api :8787 (โหลด .env)
	$(WITH_ENV) pnpm dev

infra-up: ## เปิด postgres · gotenberg · s3 (RustFS) แล้วรอ postgres พร้อม
	docker compose up -d
	@for i in $$(seq 1 30); do docker compose exec -T postgres pg_isready -U ong >/dev/null 2>&1 && exit 0; sleep 1; done; \
	echo "postgres ยังไม่พร้อม — ดู make logs SVC=postgres" >&2; exit 1

infra-down: ## ปิด infra (ข้อมูลยังอยู่)
	docker compose down

infra-reset: ## ลบ infra พร้อมข้อมูล local ทั้งหมด (ต้อง CONFIRM=yes)
	@test "$(CONFIRM)" = yes || { echo "ลบข้อมูล local ทั้งหมด — รันซ้ำด้วย CONFIRM=yes" >&2; exit 1; }
	docker compose down -v

logs: ## log ของ infra (SVC=postgres|gotenberg|s3|s3-init)
	docker compose logs -f $(SVC)

##@ ฐานข้อมูล (local)
db-migrate: .env ## migrate
	$(WITH_ENV) pnpm db:migrate

db-seed: .env ## seed ข้อมูลอ้างอิง (รันซ้ำได้)
	$(WITH_ENV) pnpm db:seed

db-generate: ## สร้าง migration หลังแก้ packages/db/src/schema.ts
	pnpm db:generate

db-psql: ## psql เข้า DB local
	docker compose exec postgres psql -U ong -d ong

##@ ตรวจคุณภาพ — ชุดเดียวกับ CI
check: lint format-check typecheck test test-coverage build bundle-budget ## ทุกอย่างที่ job check ใน CI ตรวจ (ต้องผ่านก่อน commit)

lint: ## eslint
	pnpm lint

lint-fix: ## eslint --fix
	pnpm lint:fix

format: ## prettier --write
	pnpm format

format-check: ## prettier --check
	pnpm format:check

typecheck: ## tsc ทุกแพ็กเกจ + .railway
	pnpm typecheck

test: ## vitest ทุก project + เทสต์ตัวห่อ TestSprite (เทสต์ api ต้องมี postgres — make infra-up)
	pnpm test
	pnpm --filter @ong/testsprite test

test-coverage: ## ด่าน coverage 100% ต่อไฟล์ของ packages/core จากเทสต์หน่วย (รายงาน coverage/)
	pnpm test:coverage

test-watch: ## vitest โหมด watch
	pnpm test:watch

build: ## build web + api
	pnpm build

bundle-budget: build ## ขนาด gzip ของ JS/CSS ใน apps/web/dist เทียบ scripts/ci/bundle-budget.json
	node scripts/ci/bundle-budget.js

docker-api: ## build image ของ api แบบเดียวกับ Railway
	docker build -f apps/api/Dockerfile -t $(API_IMAGE) .

##@ ความปลอดภัย — scanner ใน container ปัก digest · คำสั่งเดียวกับ CI (ต้องมี docker + jq)
scan: ci-lint secret-scan sast ## ทุกอย่างที่ job scan ใน CI ตรวจ

ci-lint: ## actionlint · zizmor · shellcheck (.github + scripts/ci)
	scripts/ci/ci-lint.sh

secret-scan: ## gitleaks: ไฟล์ที่ commit ได้ + ประวัติทั้งหมด · กัน .env ถูก track
	scripts/ci/secret-scan.sh

sast: ## semgrep CE บน apps/ packages/ (fail เมื่อเจอ ERROR)
	scripts/ci/sast.sh

sca: ## osv-scanner บน pnpm-lock.yaml (fail เมื่อ HIGH/CRITICAL · ignore ต้องมีเหตุผล + วันหมดอายุ)
	scripts/ci/sca.sh

security: ## สแกนทั้ง 4 ตัว — รันครบทุกตัวแม้ตัวก่อนหน้า fail แล้วสรุปทีเดียว
	@rc=0; for s in ci-lint secret-scan sast sca; do scripts/ci/$$s.sh || rc=1; done; exit $$rc

##@ ring 1 — image · e2e (Docker · build ทีละตัว ดิสก์ของ Docker VM จำกัด)
smoke: ## build image ของ api แบบเดียวกับ Railway แล้ว smoke (SKIP_BUILD=1 IMAGE=<tag> = ใช้ image ที่มีอยู่)
	scripts/ci/image-smoke.sh

e2e-up: ## เปิด stack e2e (compose ong-e2e · api :28787 · gotenberg :23000) · secrets ใหม่ทุกรอบ (API_IMAGE=<tag> = ใช้ image ที่มีแล้ว)
	bash tests/e2e/stack/stack.sh up

e2e: ## Playwright ทุก project กับ stack ที่เปิดอยู่ (ARGS="--project=api" เลือกได้)
	pnpm --filter @ong/e2e exec playwright test $(ARGS)

e2e-down: ## ปิด stack e2e พร้อมลบ container · volume · secrets
	bash tests/e2e/stack/stack.sh down

ci-full: ## สั่ง ci.yml ครบทุกวงแหวน (image · e2e · sca) บน branch นี้ก่อน merge (REF=<branch>)
	@ref="$(REF)"; [ -n "$$ref" ] || ref=$$(git branch --show-current); \
	gh workflow run ci.yml --ref "$$ref" && echo "สั่ง ci.yml บน $$ref แล้ว — ติดตาม: gh run watch"

##@ TestSprite (advisory · tests/testsprite/README.md)
testsprite-probe: ## backend probes ด้วย pytest ของเรา (URL=https://…|http://localhost:<port> · production ต้อง CONFIRM=yes)
	@test -n "$(URL)" || { echo "ต้องระบุ URL=https://… หรือ http://localhost:<port>" >&2; exit 1; }
	CONFIRM="$(CONFIRM)" pnpm --filter @ong/testsprite run probe "$(URL)"

testsprite-doctor: ## ตรวจ config TestSprite (env: TESTSPRITE_API_KEY · _PROJECT_ID · _PROJECT_NAME · _TARGET_URL)
	pnpm --filter @ong/testsprite run doctor

##@ Railway (ENV=staging|production · SERVICE=Office|"PDF (Gotenberg)"|"Nightly Backup"|Postgres)
railway-link: ## ผูก directory นี้กับ environment
	railway link --project "$(PROJECT)" --environment $(ENV)

railway-plan: ## ดูสิ่งที่ IaC จะเปลี่ยน (อ่านอย่างเดียว) แล้วผูกกลับ staging
	railway link --project "$(PROJECT)" --environment $(ENV) >/dev/null
	railway config plan; status=$$?; \
	[ "$(ENV)" = staging ] || railway link --project "$(PROJECT)" --environment staging >/dev/null; exit $$status

railway-apply: ## apply IaC (production ต้อง CONFIRM=yes) แล้วผูกกลับ staging
	@if [ "$(ENV)" = production ] && [ "$(CONFIRM)" != yes ]; then echo "production — รันซ้ำด้วย CONFIRM=yes" >&2; exit 1; fi
	railway link --project "$(PROJECT)" --environment $(ENV) >/dev/null
	railway config apply; status=$$?; \
	[ "$(ENV)" = staging ] || railway link --project "$(PROJECT)" --environment staging >/dev/null; exit $$status

railway-logs: ## log ของ service
	railway logs --service "$(SERVICE)" --environment $(ENV)

railway-status: ## สถานะ service ทั้งหมด
	railway service list --environment $(ENV)

##@ Git — PR เท่านั้น · merge commit (ห้าม rebase)
branch: ## สร้าง feature branch จาก dev (NAME=feat/xxx)
	@test -n "$(NAME)" || { echo "ต้องระบุ NAME=feat/..." >&2; exit 1; }
	git fetch -q origin
	git switch -c "$(NAME)" origin/dev

pr: ## push branch ปัจจุบันแล้วเปิด PR เข้า dev
	@b=$$(git branch --show-current); case "$$b" in dev|testing|staging|main) \
	echo "อยู่บน $$b — สร้าง feature branch ก่อน (make branch NAME=...)" >&2; exit 1;; esac
	git push -u origin HEAD
	gh pr create --base dev --fill-first

merge: ## รอ CI ผ่านแล้ว merge แบบ merge commit (PR=เลข)
	@test -n "$(PR)" || { echo "ต้องระบุ PR=<เลข>" >&2; exit 1; }
	@for i in $$(seq 1 30); do \
	[ "$$(gh pr view $(PR) --json statusCheckRollup --jq '.statusCheckRollup | length')" != 0 ] && break; sleep 3; done
	gh pr checks $(PR) --watch
	gh pr merge $(PR) --merge --delete-branch
	git switch dev && git pull --ff-only

# CI ต้องผ่านบน branch ต้นทาง: นับเฉพาะ run จาก push หรือ workflow_dispatch — run ของ PR promotion มีแค่ ring 0
# (ไม่มี image · e2e) จึงไม่นับ
promote: ## promote ทีละขั้นด้วย merge commit ผ่าน PR promotion (TO=testing|staging|main · main ต้อง CONFIRM=yes)
	@case "$(TO)" in testing) from=dev;; staging) from=testing;; main) from=staging;; \
	*) echo "TO ต้องเป็น testing|staging|main" >&2; exit 1;; esac; \
	if [ "$(TO)" = main ] && [ "$(CONFIRM)" != yes ]; then echo "main = release + production — รันซ้ำด้วย CONFIRM=yes" >&2; exit 1; fi; \
	git fetch -q origin; \
	sha=$$(git rev-parse "origin/$${from}"); \
	if git merge-base --is-ancestor "$$sha" "origin/$(TO)"; then echo "$(TO) มี $${from} ($${sha:0:7}) ครบแล้ว"; exit 0; fi; \
	ok=$$(gh run list --workflow ci.yml --branch "$${from}" --commit "$$sha" --status success --json event \
	--jq '[.[] | select(.event == "push" or .event == "workflow_dispatch")] | length'); \
	[ "$$ok" != 0 ] || { echo "CI บน $${from} ($${sha:0:7}) ยังไม่ผ่าน" >&2; exit 1; }; \
	n=$$(gh pr list --base "$(TO)" --head "$${from}" --state open --json number --jq '.[0].number // empty'); \
	if [ -z "$$n" ]; then \
	url=$$(gh pr create --base "$(TO)" --head "$${from}" --title "chore(release): promote $${from} to $(TO)" \
	--body "Promotion step in dev → testing → staging → main, by merge commit (not fast-forward). Merging this PR (\`gh pr merge --merge\`) is what advances \`$(TO)\`. Do NOT delete the \`$${from}\` branch when merging — it is a long-lived branch, not a feature branch."); \
	n=$${url##*/}; \
	fi; \
	for i in $$(seq 1 30); do \
	[ "$$(gh pr view $$n --json statusCheckRollup --jq '.statusCheckRollup | length')" != 0 ] && break; sleep 3; done; \
	gh pr checks $$n --watch || { echo "CI ของ PR promotion #$$n ไม่ผ่าน" >&2; exit 1; }; \
	gh pr merge $$n --merge || { echo "merge PR promotion #$$n ไม่สำเร็จ" >&2; exit 1; }; \
	mc=$$(gh pr view $$n --json mergeCommit --jq .mergeCommit.oid); \
	echo "promoted $${from} → $(TO) (merge commit $${mc:0:7})"

sync: ## อัปเดต dev/testing/staging/main ในเครื่องให้ตรงกับ GitHub
	git fetch -q --prune origin
	@cur=$$(git branch --show-current); for b in dev testing staging main; do \
	if [ "$$b" = "$$cur" ]; then git merge -q --ff-only "origin/$$b"; else git branch -f "$$b" "origin/$$b" >/dev/null; fi; \
	done; git branch -vv | grep -E '^\*? *(dev|testing|staging|main) '

##@ อื่น ๆ
clean: ## ลบ build output (dist · coverage)
	rm -rf apps/*/dist packages/*/dist coverage

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
	check lint lint-fix format format-check typecheck test test-watch build docker-api \
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

infra-up: ## เปิด postgres · gotenberg · minio แล้วรอ postgres พร้อม
	docker compose up -d
	@for i in $$(seq 1 30); do docker compose exec -T postgres pg_isready -U ong >/dev/null 2>&1 && exit 0; sleep 1; done; \
	echo "postgres ยังไม่พร้อม — ดู make logs SVC=postgres" >&2; exit 1

infra-down: ## ปิด infra (ข้อมูลยังอยู่)
	docker compose down

infra-reset: ## ลบ infra พร้อมข้อมูล local ทั้งหมด (ต้อง CONFIRM=yes)
	@test "$(CONFIRM)" = yes || { echo "ลบข้อมูล local ทั้งหมด — รันซ้ำด้วย CONFIRM=yes" >&2; exit 1; }
	docker compose down -v

logs: ## log ของ infra (SVC=postgres|gotenberg|minio)
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
check: lint format-check typecheck test build ## ทุกอย่างที่ CI ตรวจ (ต้องผ่านก่อน commit)

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

test: ## vitest ทุกแพ็กเกจ (เทสต์ api ต้องมี postgres — make infra-up)
	pnpm test

test-watch: ## vitest โหมด watch
	pnpm test:watch

build: ## build web + api
	pnpm build

docker-api: ## build image ของ api แบบเดียวกับ Railway
	docker build -f apps/api/Dockerfile -t $(API_IMAGE) .

##@ Railway (ENV=staging|production · SERVICE=Office|"PDF (Gotenberg)"|Postgres)
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

# SHA เดียวกันมี run หลายชุด (push ของ dev · testing · staging และ PR promotion) — นับเฉพาะ run ของ branch ต้นทาง
# ที่มาจาก push หรือ workflow_dispatch (ขั้น sync หลัง release) · ไม่งั้น run ที่ผ่านบน dev หรือบน PR (ไม่มี image/e2e)
# จะปล่อย testing → staging ทั้งที่ e2e บน testing ตก
promote: ## promote ทีละขั้นแบบ fast-forward (TO=testing|staging|main · main ต้อง CONFIRM=yes)
	@case "$(TO)" in testing) from=dev;; staging) from=testing;; main) from=staging;; \
	*) echo "TO ต้องเป็น testing|staging|main" >&2; exit 1;; esac; \
	if [ "$(TO)" = main ] && [ "$(CONFIRM)" != yes ]; then echo "main = release + production — รันซ้ำด้วย CONFIRM=yes" >&2; exit 1; fi; \
	git fetch -q origin; \
	sha=$$(git rev-parse "origin/$${from}"); \
	if [ "$$(git rev-parse "origin/$(TO)")" = "$$sha" ]; then echo "$(TO) อยู่ที่ $${sha:0:7} แล้ว"; exit 0; fi; \
	git merge-base --is-ancestor "origin/$(TO)" "$$sha" || { echo "$(TO) มี commit ที่ $${from} ไม่มี — fast-forward ไม่ได้" >&2; exit 1; }; \
	ok=$$(gh run list --workflow ci.yml --branch "$${from}" --commit "$$sha" --status success --json event \
	--jq '[.[] | select(.event == "push" or .event == "workflow_dispatch")] | length'); \
	[ "$$ok" != 0 ] || { echo "CI ของ $${from} ยังไม่ผ่านที่ $${sha:0:7}" >&2; exit 1; }; \
	gh pr create --base "$(TO)" --head "$${from}" --title "chore(release): promote $${from} to $(TO)" \
	--body "Promotion `$(TO) ← $${from}` by fast-forward push (same SHAs). Do not use the merge buttons."; \
	git push origin "$${sha}:refs/heads/$(TO)"; \
	echo "promoted $${from} → $(TO) at $${sha:0:7}"

sync: ## อัปเดต dev/testing/staging/main ในเครื่องให้ตรงกับ GitHub
	git fetch -q --prune origin
	@cur=$$(git branch --show-current); for b in dev testing staging main; do \
	if [ "$$b" = "$$cur" ]; then git merge -q --ff-only "origin/$$b"; else git branch -f "$$b" "origin/$$b" >/dev/null; fi; \
	done; git branch -vv | grep -E '^\*? *(dev|testing|staging|main) '

##@ อื่น ๆ
clean: ## ลบ build output (dist · coverage)
	rm -rf apps/*/dist packages/*/dist coverage

#!/usr/bin/env bash
# Image smoke test for the deployable api image — apps/api/Dockerfile, the one Railway builds (context =
# repo root). Proves the built image boots in production mode and behaves at its edges before promotion.
#
#   make smoke                                                      # build the image, then smoke it
#   SKIP_BUILD=1 IMAGE=ong-smoke-api:ci scripts/ci/image-smoke.sh   # CI: smoke the image built once
#
# Everything runs from the image itself (no host node/pnpm):
#   1. image config: non-root USER, no secret-looking ENV, HEALTHCHECK (info), size   (CIS Docker 4.1/4.6/4.10)
#   2. private network + throwaway Postgres 18 (same digest as docker-compose.yml, no published port)
#   3. Railway pre-deploy: `node dist/migrate.js` (production), then the non-production command
#      `migrate && seed` twice — every run exits 0 and the second leaves the seeded rows byte-identical
#   4. NODE_ENV=production must refuse to boot (fail closed) with the .env.example auth secret, the
#      example Gotenberg password, or a tax ID whose check digit is wrong — and say which variable
#   5. boot with production-like synthetic env: random 48-char secrets, PORT injected like Railway does,
#      a synthetic company header (name "ทดสอบ …", tax ID with a valid check digit), S3 and Gotenberg on
#      unresolvable *.invalid hosts (proves boot and /healthz need neither); hardened runtime
#      (--read-only, --cap-drop ALL, no-new-privileges)                             (CIS Docker 5.3/5.12/5.25)
#   6. HTTP: /healthz and /api/healthz ok:true · / and SPA deep links serve the image's index.html ·
#      assets served · /api/me 401 without a session · state-changing requests with a foreign or
#      missing Origin 403 (with a same-origin control that reaches the session check instead)
#   7. the process runs as non-root · `docker stop` is graceful (exit 0 within STOP_TIMEOUT)
#   8. security response headers on / and /api/* recorded (OWASP Secure Headers Project, ASVS 4.0.3 V14.4)
#      — reported as warnings, not failures, until the app sets them
#
# Env: IMAGE (ong-smoke-api:local) · SKIP_BUILD=1 · SMOKE_PORT (18787, loopback only) · BOOT_TIMEOUT (90 s)
#      STOP_TIMEOUT (10 s) · SMOKE_STRICT_HEADERS=1 (missing security headers fail instead of warn)
#      SMOKE_WAIVE_UNGRACEFUL_STOP_UNTIL=YYYY-MM-DD (time-boxed waiver: an ungraceful stop only warns
#      until that date, then fails again) · SMOKE_AUTH_SECRET (override the random secret; negative
#      controls only)
# Every container and network it creates is named ong-smoke-* and removed on exit, pass or fail.
# Bash 3.2 compatible (macOS /bin/bash): no associative arrays, no mapfile.
set -euo pipefail

case "${1:-}" in
  -h | --help)
    sed -n '2,/^set -euo/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
    exit 0
    ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

IMAGE="${IMAGE:-ong-smoke-api:local}"
SMOKE_PORT="${SMOKE_PORT:-18787}"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-90}"
STOP_TIMEOUT="${STOP_TIMEOUT:-10}"
# Railway injects PORT at runtime; use a value other than the app default (8787) to prove it is honoured
APP_PORT=8080
PUBLIC_URL="http://localhost:${SMOKE_PORT}"
BASE_URL="http://127.0.0.1:${SMOKE_PORT}"
# example values shipped in .env.example / docker-compose.yml — production must refuse them
PLACEHOLDER_SECRET="local-dev-only-secret-change-me-0123456789"
EXAMPLE_GOTENBERG_PASSWORD="ongongong"
# synthetic company header (test data rules: name starts with ทดสอบ, never the shop's real details)
COMPANY_NAME="ทดสอบ หลอมทองสมมติ"
COMPANY_ADDRESS="99/9 ถนนทดสอบ ตำบลทดสอบ อำเภอเมือง จังหวัดทดสอบ 99999"
COMPANY_TEL="0999999999"
SYNTHETIC_TAX_PREFIX="123456789012" # obviously fake; the 13th digit is computed below

RUN_ID="$(date +%s)-$$"
NET="ong-smoke-net-${RUN_ID}"
PG="ong-smoke-pg-${RUN_ID}"
API="ong-smoke-api-${RUN_ID}"
LABEL="ong-smoke.run=${RUN_ID}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ong-smoke.XXXXXX")"
RESULTS="${WORK}/results.tsv"
: >"$RESULTS"
FAILED=0

# ---------- helpers ----------

step() { printf '\n==> %s\n' "$*"; }

annotate() { # level title message — GitHub Actions workflow command (escaped per the runner's rules)
  [ "${GITHUB_ACTIONS:-}" = true ] || return 0
  local msg="$3"
  msg="${msg//'%'/%25}"
  msg="${msg//$'\n'/%0A}"
  echo "::$1 title=image smoke::$2 — ${msg}"
}

record() { # status check detail — status: PASS FAIL WARN INFO
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >>"$RESULTS"
  printf '%-5s %s — %s\n' "$1" "$2" "$3"
  case "$1" in
    FAIL)
      FAILED=1
      annotate error "$2" "$3"
      ;;
    WARN) annotate warning "$2" "$3" ;;
  esac
}

die() {
  record FAIL "fatal" "$*"
  exit 1
}

need() { command -v "$1" >/dev/null 2>&1 || die "missing tool: $1"; }

wait_until() { # description timeout_seconds command... — poll until the command succeeds
  local what=$1 timeout=$2 start=$SECONDS
  shift 2
  until "$@" >/dev/null 2>&1; do
    if [ $((SECONDS - start)) -ge "$timeout" ]; then
      return 1
    fi
    sleep 0.5
  done
  echo "    ${what} after $((SECONDS - start)) s"
}

container_running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }
container_exited() { ! container_running "$1"; }

# docker run flags shared by every container started from the image under test
HARDEN=(--read-only --tmpfs "/tmp:rw,noexec,nosuid,size=16m" --cap-drop ALL --security-opt no-new-privileges)

run_image() { # name command... — one-off container on the private network with the image's own env
  local name=$1
  shift
  docker run --rm --name "ong-smoke-${name}-${RUN_ID}" --label "$LABEL" --network "$NET" "${HARDEN[@]}" \
    -e DATABASE_URL="$DATABASE_URL" "$IMAGE" "$@"
}

psql_q() { docker exec "$PG" psql -X -A -t -q -v ON_ERROR_STOP=1 -U ong -d ong -c "$1"; }

db_snapshot() { # "<migrations applied> <seeded rows> <md5 of every seeded row, all columns>"
  psql_q "select (select count(*) from drizzle.__drizzle_migrations) || ' ' || count(*) || ' '
    || left(md5(coalesce(string_agg(r, '|' order by r), '')), 12) from (
      select b::text as r from branch b union all select m::text from metal m
      union all select g::text from gold_price_setting g) seeded"
}

thai_check_digit() { # 12 digits → 13th digit, the mod-11 rule of isValidNationalId() in @ong/core
  local digits=$1 sum=0 i
  for ((i = 0; i < 12; i++)); do sum=$((sum + ${digits:i:1} * (13 - i))); done
  echo $(((11 - sum % 11) % 10))
}

HTTP_STATUS=000
http() { # method path [curl args...] — body → $WORK/body, headers → $WORK/headers, status → HTTP_STATUS
  local method=$1 path=$2
  shift 2
  HTTP_STATUS="$(curl -sS -o "${WORK}/body" -D "${WORK}/headers" -w '%{http_code}' --max-time 10 \
    -X "$method" "$@" "${BASE_URL}${path}" 2>"${WORK}/curl.err")" || HTTP_STATUS=000
}

header() { # name — value of a response header from the last http() call (empty when absent)
  grep -i "^$1:" "${WORK}/headers" | tail -n 1 | cut -d: -f2- | tr -d '\r' | sed -e 's/^ *//' || true
}

body_snippet() { head -c 160 "${WORK}/body" | tr '\n' ' '; }

expect() { # check expected_status [jq filter that must be true]
  local check=$1 want=$2 filter=${3:-}
  if [ "$HTTP_STATUS" != "$want" ]; then
    record FAIL "$check" "expected HTTP ${want}, got ${HTTP_STATUS}: $(body_snippet)"
  elif [ -n "$filter" ] && ! jq -e "$filter" "${WORK}/body" >/dev/null 2>&1; then
    record FAIL "$check" "HTTP ${HTTP_STATUS} but body fails ${filter}: $(body_snippet)"
  else
    record PASS "$check" "HTTP ${HTTP_STATUS}${filter:+ · ${filter}}"
  fi
}

cleanup() {
  local status=$?
  set +e
  if [ "$status" -ne 0 ] && docker container inspect "$API" >/dev/null 2>&1; then
    echo "--- api logs (last 80 lines) ---"
    docker logs --tail 80 "$API" 2>&1
  fi
  summary
  local ids
  ids="$(docker ps -aq --filter "label=${LABEL}")"
  # shellcheck disable=SC2086 # one container id per word
  [ -z "$ids" ] || docker rm -f -v $ids >/dev/null
  docker network rm "$NET" >/dev/null 2>&1
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

summary() { # printed on every exit, pass or fail
  [ -s "$RESULTS" ] || return 0
  echo
  echo "image smoke — ${IMAGE} (${IMAGE_ID:-no image id}, ${SIZE_MB:-?} MB)"
  awk -F '\t' '{ printf "  %-5s %-52s %s\n", $1, $2, $3 }' "$RESULTS"
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] || return 0
  {
    echo "### Image smoke — \`${IMAGE}\`"
    echo
    echo "Image \`${IMAGE_ID:-?}\` · ${SIZE_MB:-?} MB · Postgres \`${PG_IMAGE:-?}\`"
    echo
    echo "| Status | Check | Detail |"
    echo "| --- | --- | --- |"
    awk -F '\t' '{ gsub(/\|/, "\\|", $3); printf "| %s | %s | %s |\n", $1, $2, $3 }' "$RESULTS"
    if [ -s "${WORK}/headers.md" ]; then
      echo
      echo "Security response headers (OWASP Secure Headers Project · ASVS 4.0.3 V14.4):"
      echo
      echo "| Header | \`/\` | \`/api/healthz\` |"
      echo "| --- | --- | --- |"
      cat "${WORK}/headers.md"
    fi
    echo
  } >>"$GITHUB_STEP_SUMMARY"
}

# ---------- preflight ----------

for tool in docker curl jq openssl awk cmp; do need "$tool"; done
[[ "$STOP_TIMEOUT" =~ ^[0-9]+$ && "$BOOT_TIMEOUT" =~ ^[0-9]+$ ]] || die "STOP_TIMEOUT/BOOT_TIMEOUT must be whole seconds"

# single source of truth for the Postgres image: the digest pinned in docker-compose.yml (Renovate bumps it)
PG_IMAGE="$(sed -nE 's/^[[:space:]]*image:[[:space:]]*(postgres:[^[:space:]]+@sha256:[0-9a-f]{64}).*/\1/p' docker-compose.yml |
  head -n 1)"
[ -n "$PG_IMAGE" ] || die "docker-compose.yml has no digest-pinned postgres image"

if [ "${SKIP_BUILD:-0}" != 1 ]; then
  step "build ${IMAGE} from apps/api/Dockerfile (context = repo root, same as Railway)"
  docker build -f apps/api/Dockerfile -t "$IMAGE" .
fi
docker image inspect "$IMAGE" >/dev/null 2>&1 || die "image ${IMAGE} not found — build it or unset SKIP_BUILD"
IMAGE_ID="$(docker image inspect -f '{{.Id}}' "$IMAGE")"

# ---------- 1. image config ----------

step "image config"
image_user="$(docker image inspect -f '{{.Config.User}}' "$IMAGE")"
case "$image_user" in
  "" | root | 0 | 0:* | root:*) record FAIL "image USER is non-root" "USER='${image_user}'" ;;
  *) record PASS "image USER is non-root" "USER=${image_user}" ;;
esac

secret_env="$(docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$IMAGE" |
  cut -d= -f1 | grep -Ei 'SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE|ACCESS_KEY|API_KEY' || true)"
if [ -z "$secret_env" ]; then
  record PASS "no secret-looking ENV baked into the image" "checked names in Config.Env"
else
  record FAIL "no secret-looking ENV baked into the image" "found: $(echo "$secret_env" | tr '\n' ' ')"
fi

if [ "$(docker image inspect -f '{{if .Config.Healthcheck}}yes{{end}}' "$IMAGE")" = yes ]; then
  record PASS "image HEALTHCHECK" "declared"
else
  record INFO "image HEALTHCHECK" "none (CIS Docker 4.6) — Railway health-checks /healthz itself"
fi

size_bytes="$(docker image inspect -f '{{.Size}}' "$IMAGE")"
SIZE_MB="$(awk -v b="$size_bytes" 'BEGIN { printf "%.1f", b / 1000000 }')"
record INFO "image size" "${size_bytes} bytes (${SIZE_MB} MB), $(docker image inspect -f '{{len .RootFS.Layers}}' "$IMAGE") layers"

# ---------- 2. private network + Postgres ----------

step "private network ${NET} + ${PG_IMAGE}"
docker network create --label "$LABEL" "$NET" >/dev/null
PG_PASSWORD="$(openssl rand -hex 24)"
docker run -d --name "$PG" --label "$LABEL" --network "$NET" --tmpfs /var/lib/postgresql \
  -e POSTGRES_USER=ong -e POSTGRES_DB=ong -e POSTGRES_PASSWORD="$PG_PASSWORD" "$PG_IMAGE" >/dev/null
# TCP check: the entrypoint's temporary init server listens on the unix socket only
wait_until "postgres accepts TCP connections" "$BOOT_TIMEOUT" docker exec "$PG" pg_isready -q -h 127.0.0.1 -U ong -d ong ||
  die "postgres not ready within ${BOOT_TIMEOUT} s"
DATABASE_URL="postgres://ong:${PG_PASSWORD}@${PG}:5432/ong"

# ---------- 3. Railway pre-deploy, repeated ----------

step "pre-deploy: migrate (production command), then migrate && seed twice (non-production command)"
expected_migrations="$(docker run --rm --label "$LABEL" --network none --entrypoint cat "$IMAGE" \
  /app/migrations/meta/_journal.json | jq '.entries | length')" || die "cannot read /app/migrations/meta/_journal.json"

run_image migrate node dist/migrate.js || die "node dist/migrate.js failed on an empty database"
after_migrate="$(db_snapshot)"
applied="${after_migrate%% *}"
if [ "$applied" = "$expected_migrations" ]; then
  record PASS "migrate on an empty database" "${applied}/${expected_migrations} migrations applied"
else
  record FAIL "migrate on an empty database" "${applied} applied, image ships ${expected_migrations}"
fi

PREDEPLOY='node dist/migrate.js && node dist/seed.js' # .railway/railway.ts, non-production environments
run_image predeploy1 /bin/sh -c "$PREDEPLOY" || die "pre-deploy (migrate && seed) failed on the first run"
first="$(db_snapshot)"
run_image predeploy2 /bin/sh -c "$PREDEPLOY" || die "pre-deploy (migrate && seed) failed on the second run"
second="$(db_snapshot)"
read -r first_migrations first_rows _ <<<"$first"
if [ "$first_migrations" = "$expected_migrations" ] && [ "$first_rows" -gt 0 ] && [ "$first" = "$second" ]; then
  record PASS "migrate + seed are idempotent" "migrations rows md5: ${first} → ${second} (unchanged)"
else
  record FAIL "migrate + seed are idempotent" "migrations rows md5: ${after_migrate} → ${first} → ${second}"
fi

# ---------- 4. production refuses unsafe settings ----------

step "NODE_ENV=production must refuse example secrets and a mistyped tax ID"
AUTH_SECRET="${SMOKE_AUTH_SECRET:-$(openssl rand -base64 36)}" # 36 random bytes → 48 characters
GOTENBERG_PASSWORD="$(openssl rand -hex 24)"
TAX_CHECK="$(thai_check_digit "$SYNTHETIC_TAX_PREFIX")"
TAX_ID="${SYNTHETIC_TAX_PREFIX}${TAX_CHECK}"
BAD_TAX_ID="${SYNTHETIC_TAX_PREFIX}$(((TAX_CHECK + 1) % 10))"
APP_ENV=(
  -e NODE_ENV=production
  -e PORT="$APP_PORT"
  -e DATABASE_URL="$DATABASE_URL"
  -e BETTER_AUTH_URL="$PUBLIC_URL"
  # RFC 6761 .invalid never resolves: boot and /healthz must not depend on object storage or the PDF service
  -e S3_ENDPOINT=https://ong-smoke-s3.invalid
  -e S3_REGION=auto
  -e S3_BUCKET=ong-smoke
  -e S3_ACCESS_KEY="ong-smoke-$(openssl rand -hex 8)"
  -e S3_SECRET_KEY="$(openssl rand -hex 24)"
  -e S3_FORCE_PATH_STYLE=false
  -e GOTENBERG_URL=http://ong-smoke-gotenberg.invalid:3000
  -e GOTENBERG_USERNAME=ong
  -e COMPANY_NAME="$COMPANY_NAME"
  -e COMPANY_ADDRESS="$COMPANY_ADDRESS"
  -e COMPANY_TEL="$COMPANY_TEL"
  # COMPANY_FAX unset, as on Railway (the receipt prints "-")
)

start_api() { # name auth_secret gotenberg_password tax_id [docker run args...]
  local name=$1 secret=$2 password=$3 tax_id=$4
  shift 4
  docker run -d --name "$name" --label "$LABEL" --network "$NET" "${HARDEN[@]}" "${APP_ENV[@]}" \
    -e BETTER_AUTH_SECRET="$secret" -e GOTENBERG_PASSWORD="$password" -e COMPANY_TAX_ID="$tax_id" \
    "$@" "$IMAGE" >/dev/null
}

refuses() { # check variable auth_secret gotenberg_password tax_id — must exit non-zero naming the variable
  local check=$1 variable=$2 name="ong-smoke-badenv-${RUN_ID}" code logs
  start_api "$name" "$3" "$4" "$5"
  if wait_until "${variable} container exited" 30 container_exited "$name"; then
    code="$(docker inspect -f '{{.State.ExitCode}}' "$name")"
    logs="$(docker logs "$name" 2>&1)"
    if [ "$code" != 0 ] && grep -q "invalid environment.*${variable}" <<<"$logs"; then
      record PASS "$check" "exit ${code}, invalid environment names ${variable}"
    else
      record FAIL "$check" "exit ${code}: $(tail -n 3 <<<"$logs" | tr '\n' ' ')"
    fi
  else
    record FAIL "$check" "still running after 30 s"
  fi
  docker rm -f "$name" >/dev/null
}

refuses "production refuses the example auth secret" BETTER_AUTH_SECRET \
  "$PLACEHOLDER_SECRET" "$GOTENBERG_PASSWORD" "$TAX_ID"
refuses "production refuses the example Gotenberg password" GOTENBERG_PASSWORD \
  "$AUTH_SECRET" "$EXAMPLE_GOTENBERG_PASSWORD" "$TAX_ID"
refuses "a tax ID with a wrong check digit is refused" COMPANY_TAX_ID \
  "$AUTH_SECRET" "$GOTENBERG_PASSWORD" "$BAD_TAX_ID"

# ---------- 5. boot ----------

step "boot ${IMAGE} with NODE_ENV=production on 127.0.0.1:${SMOKE_PORT} (PORT=${APP_PORT} inside)"
start_api "$API" "$AUTH_SECRET" "$GOTENBERG_PASSWORD" "$TAX_ID" -p "127.0.0.1:${SMOKE_PORT}:${APP_PORT}"

healthy() {
  container_running "$API" || return 2
  curl -fsS --max-time 2 "${BASE_URL}/healthz" 2>/dev/null | jq -e '.ok == true' >/dev/null
}
boot_start=$SECONDS
until healthy; do
  if ! container_running "$API"; then
    die "api exited during boot with code $(docker inspect -f '{{.State.ExitCode}}' "$API")"
  fi
  if [ $((SECONDS - boot_start)) -ge "$BOOT_TIMEOUT" ]; then
    die "/healthz not ok within ${BOOT_TIMEOUT} s"
  fi
  sleep 0.5
done
record PASS "boots in production mode" \
  "/healthz ok after $((SECONDS - boot_start)) s; tax ID ${TAX_ID}; S3 and Gotenberg unresolvable (not needed)"

# ---------- 6. HTTP behaviour ----------

step "HTTP checks against ${BASE_URL}"
http GET /healthz
expect "GET /healthz" 200 '.ok == true'
http GET /api/healthz
expect "GET /api/healthz" 200 '.ok == true'
cp "${WORK}/headers" "${WORK}/headers.api"

docker exec "$API" cat /app/public/index.html >"${WORK}/index.html"
http GET /
cp "${WORK}/headers" "${WORK}/headers.root"
content_type="$(header content-type)"
if [ "$HTTP_STATUS" = 200 ] && cmp -s "${WORK}/body" "${WORK}/index.html" && [[ "$content_type" == text/html* ]]; then
  record PASS "GET / serves the SPA" "HTTP 200, ${content_type}, identical to /app/public/index.html"
else
  record FAIL "GET / serves the SPA" "HTTP ${HTTP_STATUS}, ${content_type}: $(body_snippet)"
fi

http GET /customers/00000000-0000-0000-0000-000000000001
if [ "$HTTP_STATUS" = 200 ] && cmp -s "${WORK}/body" "${WORK}/index.html"; then
  record PASS "SPA deep link falls back to index.html" "HTTP 200 on /customers/<id>"
else
  record FAIL "SPA deep link falls back to index.html" "HTTP ${HTTP_STATUS}: $(body_snippet)"
fi

asset="$(grep -oE '/assets/[^"]+\.js' "${WORK}/index.html" | head -n 1 || true)"
if [ -z "$asset" ]; then
  record FAIL "entry script is served" "no /assets/*.js referenced by index.html"
else
  http GET "$asset" -H 'accept-encoding: gzip, br'
  content_type="$(header content-type)"
  if [ "$HTTP_STATUS" = 200 ] && [[ "$content_type" == *javascript* ]]; then
    record PASS "entry script is served" "${asset}: HTTP 200, ${content_type}"
  else
    record FAIL "entry script is served" "${asset}: HTTP ${HTTP_STATUS}, ${content_type}"
  fi
  encoding="$(header content-encoding)"
  caching="$(header cache-control)"
  record INFO "static asset delivery" "content-encoding: ${encoding:-none} · cache-control: ${caching:-none}"
fi

http GET /api/me
expect "GET /api/me without a session is 401" 401 '.error == "unauthorized"'

http POST /api/me/branch -H 'origin: https://evil.example' -H 'content-type: application/json' --data '{}'
expect "POST with a foreign Origin is 403" 403 '.error == "forbidden origin"'
http POST /api/me/branch -H 'content-type: application/json' --data '{}'
expect "POST without an Origin is 403" 403 '.error == "forbidden origin"'
http POST /api/auth/sign-in/email -H 'origin: https://evil.example' -H 'content-type: application/json' \
  --data '{"email":"nobody@example.invalid","password":"not-a-real-password"}'
expect "sign-in with a foreign Origin is 403" 403 '.error == "forbidden origin"'
# control: the same request from the app's own origin passes the Origin gate and stops at the session check
http POST /api/me/branch -H "origin: ${PUBLIC_URL}" -H 'content-type: application/json' --data '{}'
expect "POST with the app Origin gets 401 (session)" 401 '.error == "unauthorized"'

http GET /api/no-such-endpoint
if [ "$HTTP_STATUS" = 404 ] && jq -e '.error' "${WORK}/body" >/dev/null 2>&1; then
  record PASS "unknown /api/* path is a JSON 404" "HTTP 404"
else
  record WARN "unknown /api/* path is a JSON 404" "HTTP ${HTTP_STATUS} $(header content-type) — API 404 falls through to the SPA"
fi

# ---------- 7. process identity ----------

step "process identity"
uid="$(docker exec "$API" id -u)"
runtime_user="$(docker exec "$API" id -un)"
pid1_uid="$(docker exec "$API" awk '/^Uid:/ { print $2 }' /proc/1/status)"
if [ "$uid" != 0 ] && [ "$pid1_uid" != 0 ]; then
  record PASS "process runs as non-root" "PID 1 uid ${pid1_uid} (${runtime_user})"
else
  record FAIL "process runs as non-root" "exec uid ${uid}, PID 1 uid ${pid1_uid}"
fi
# the app must not be able to rewrite its own code even without --read-only
owners="$(docker exec "$API" stat -c '%U' /app/dist/index.js /app/public/index.html /app/node_modules /app/migrations |
  sort -u | tr '\n' ' ')"
if [ "$uid" != 0 ] && [[ " ${owners}" != *" ${runtime_user} "* ]]; then
  record PASS "app files not owned by the runtime user" "owner: ${owners% }"
else
  record WARN "app files not owned by the runtime user" "owners: ${owners% } · runtime user: ${runtime_user}"
fi

# ---------- 8. security headers (report only) ----------

step "security response headers"
# name|recommended value — OWASP Secure Headers Project; cache-control matters for API responses only
SECURITY_HEADERS=(
  "strict-transport-security|max-age=63072000; includeSubDomains"
  "content-security-policy|default-src 'self'; frame-ancestors 'none'; object-src 'none'"
  "x-content-type-options|nosniff"
  "x-frame-options|DENY"
  "referrer-policy|no-referrer"
  "permissions-policy|camera=(), geolocation=(), microphone=()"
  "cross-origin-opener-policy|same-origin"
  "cross-origin-resource-policy|same-origin"
  "cache-control|no-store (API)"
)
: >"${WORK}/headers.md"
missing_root=""
missing_api=""
for entry in "${SECURITY_HEADERS[@]}"; do
  name="${entry%%|*}"
  root_value="$(grep -i "^${name}:" "${WORK}/headers.root" | tail -n 1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//' || true)"
  api_value="$(grep -i "^${name}:" "${WORK}/headers.api" | tail -n 1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//' || true)"
  if [ "$name" != cache-control ] && [ -z "$root_value" ]; then missing_root="${missing_root} ${name}"; fi
  if [ -z "$api_value" ]; then missing_api="${missing_api} ${name}"; fi
  printf '| %s | %s | %s |\n' "$name" "${root_value:-**missing**}" "${api_value:-**missing**}" >>"${WORK}/headers.md"
  printf '    %-30s /: %-28s /api: %s\n' "$name" "${root_value:-MISSING}" "${api_value:-MISSING}"
done
for name in server x-powered-by; do
  for which in root api; do
    value="$(grep -i "^${name}:" "${WORK}/headers.${which}" | tail -n 1 | cut -d: -f2- | tr -d '\r' || true)"
    if [ -n "$value" ]; then
      record WARN "no ${name} header disclosure" "${which}: ${name}:${value}"
    fi
  done
done
header_status=WARN
[ "${SMOKE_STRICT_HEADERS:-0}" != 1 ] || header_status=FAIL
if [ -z "$missing_root" ]; then
  record PASS "security headers on /" "all recommended headers present"
else
  record "$header_status" "security headers on /" "missing:${missing_root}"
fi
if [ -z "$missing_api" ]; then
  record PASS "security headers on /api/*" "all recommended headers present"
else
  record "$header_status" "security headers on /api/*" "missing:${missing_api}"
fi

logs="$(docker logs "$API" 2>&1)"
if grep -q 'GET /api/me' <<<"$logs"; then
  record PASS "API requests are access-logged" "found 'GET /api/me' in the container log"
else
  record WARN "API requests are access-logged" "no log line for GET /api/me (ASVS 4.0.3 V7.1)"
fi

# ---------- 9. graceful stop ----------

step "docker stop -t ${STOP_TIMEOUT}"
stop_start=$SECONDS
docker stop -t "$STOP_TIMEOUT" "$API" >/dev/null
stop_seconds=$((SECONDS - stop_start))
exit_code="$(docker inspect -f '{{.State.ExitCode}}' "$API")"
if [ "$exit_code" = 0 ] && [ "$stop_seconds" -lt "$STOP_TIMEOUT" ]; then
  record PASS "docker stop is graceful" "exit 0 after ${stop_seconds} s"
else
  detail="exit ${exit_code} after ${stop_seconds} s (137 = SIGKILL after the grace period: SIGTERM not handled by PID 1)"
  waiver="${SMOKE_WAIVE_UNGRACEFUL_STOP_UNTIL:-}"
  if [[ "$waiver" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] && [[ ! "$(date -u +%Y-%m-%d)" > "$waiver" ]]; then
    record WARN "docker stop is graceful" "${detail} — waived until ${waiver}"
  else
    record FAIL "docker stop is graceful" "$detail"
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  echo "image smoke FAILED" >&2
  exit 1
fi
echo "image smoke passed"

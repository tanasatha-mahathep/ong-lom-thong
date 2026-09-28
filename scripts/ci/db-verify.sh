#!/usr/bin/env bash
# db-verify — prove every database migration is safe to deploy (CI ring 0 · `make db-verify`).
#
#   1 drift              drizzle-kit generate against schema.ts creates or changes nothing
#   2 append-only        what BASE_REF deployed is untouched: files, journal prefix, order, snapshot chain
#   3 upgrade path       BASE_REF migrate + seed with its own code, then HEAD migrate, BASE_REF seed again
#                        (old code still serves while the new release boots), HEAD seed
#   4 fresh install      HEAD migrations twice (2nd = no-op) and the seed twice (2nd = no-op)
#   5 convergence        upgraded and fresh databases end with identical catalogs and bookkeeping
#   6 canonical plpgsql  re-applying packages/db/sql/functions.sql changes nothing, and the file alone
#                        recreates every deployed routine and trigger
#
# Inputs
#   TEST_DATABASE_URL  admin connection (default postgres://ong:ong@localhost:5432/postgres) — scratch
#                      databases dbv_* are created on that server and dropped on exit
#   BASE_REF           what production runs (default: newest v* tag reachable from origin/main, else
#                      origin/main) — needs full history and tags (actions/checkout fetch-depth: 0)
#   DB_VERIFY_KEEP=1   keep the scratch databases and work directory for debugging
#
# Exit 0 = every check passed · 1 = a check failed · 2 = could not run (bad input or environment).
# Writes a markdown table to $GITHUB_STEP_SUMMARY when that variable is set.
set -euo pipefail

cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
REPO_ROOT=$PWD
DB_REL=packages/db
MIGRATIONS_REL=$DB_REL/migrations
DB_PKG=$REPO_ROOT/$DB_REL
MIGRATIONS=$REPO_ROOT/$MIGRATIONS_REL
FUNCTIONS_SQL=$DB_PKG/sql/functions.sql
TSX=$DB_PKG/node_modules/.bin/tsx
DRIZZLE_KIT=$DB_PKG/node_modules/.bin/drizzle-kit
GENERATE_TIMEOUT=${DB_VERIFY_GENERATE_TIMEOUT:-120}
INSTALL_TIMEOUT=${DB_VERIFY_INSTALL_TIMEOUT:-300}
export TEST_DATABASE_URL=${TEST_DATABASE_URL:-postgres://ong:ong@localhost:5432/postgres}

die() {
  echo "db-verify: $*" >&2
  exit 2
}

for tool in git node pnpm diff tar; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool not found"
done
[ -x "$TSX" ] && [ -x "$DRIZZLE_KIT" ] || die "packages/db dependencies missing — run pnpm install"

helper() { "$TSX" "$DB_PKG/src/ci/db-verify.ts" "$@"; }

# portable timeout: coreutils timeout/gtimeout, else perl alarm (macOS without coreutils)
run_with_timeout() {
  local secs=$1
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout --kill-after=10 "$secs" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout --kill-after=10 "$secs" "$@"
  else
    perl -e 'alarm shift; exec @ARGV or die "exec $ARGV[0]: $!\n"' "$secs" "$@"
  fi
}
timed_out() { [ "$1" -eq 124 ] || [ "$1" -eq 137 ] || [ "$1" -eq 142 ]; }

# ---------------------------------------------------------------- workspace + cleanup

WORK=$(mktemp -d "${TMPDIR:-/tmp}/db-verify.XXXXXX")
RUN_ID="dbv_$(date +%Y%m%d%H%M%S)_$$_${RANDOM}"
UP_DB=${RUN_ID}_up
FRESH_DB=${RUN_ID}_fresh
CREATED_DBS=()

cleanup() {
  local rc=$?
  if [ "${DB_VERIFY_KEEP:-0}" = 1 ]; then
    echo "db-verify: kept databases ${CREATED_DBS[*]:-(none)} and work directory $WORK" >&2
  else
    if [ ${#CREATED_DBS[@]} -gt 0 ]; then
      helper drop "${CREATED_DBS[@]}" >/dev/null 2>&1 ||
        echo "db-verify: warning — could not drop ${CREATED_DBS[*]} (drop them by hand)" >&2
    fi
    rm -rf "$WORK"
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

create_db() {
  helper create "$1" && CREATED_DBS+=("$1")
}

# ---------------------------------------------------------------- results

IDS=()
TITLES=()
STATUSES=()
DETAILS=()
FAILED=0

# record <id> <title> <PASS|FAIL|SKIP> <one-line detail> [<file with more detail>]
record() {
  local id=$1 title=$2 status=$3 detail=$4 more=${5:-}
  IDS+=("$id")
  TITLES+=("$title")
  STATUSES+=("$status")
  DETAILS+=("$detail")
  [ "$status" = FAIL ] && FAILED=1
  printf '%-4s  %s %-18s %s\n' "$status" "$id" "$title" "$detail"
  if [ -n "$more" ] && [ -s "$more" ]; then
    head -n 200 "$more" | sed 's/^/      /'
    cp "$more" "$WORK/detail-$id.txt"
  fi
  return 0
}

# diff_into <out> <label-a> <file-a> <label-b> <file-b> — true when identical
diff_into() {
  diff -u -L "$2" -L "$4" "$3" "$5" >"$1" 2>&1
}

# ---------------------------------------------------------------- refs

if [ -z "${BASE_REF:-}" ]; then
  git rev-parse --verify --quiet origin/main >/dev/null ||
    die "origin/main not found — fetch full history and tags (CI: actions/checkout with fetch-depth: 0), or set BASE_REF"
  BASE_REF=$(git describe --tags --abbrev=0 --match 'v*' origin/main 2>/dev/null || echo origin/main)
fi
BASE_SHA=$(git rev-parse --verify --quiet "${BASE_REF}^{commit}") ||
  die "BASE_REF '$BASE_REF' not found — fetch full history and tags (CI: fetch-depth: 0)"
BASE_LABEL="$BASE_REF"
HEAD_LABEL="HEAD $(git rev-parse --short HEAD)"
[ -z "$(git status --porcelain -- "$DB_REL")" ] || HEAD_LABEL="$HEAD_LABEL + uncommitted packages/db changes"
BASE_HAS_MIGRATIONS=0
git cat-file -e "$BASE_SHA:$MIGRATIONS_REL/meta/_journal.json" 2>/dev/null && BASE_HAS_MIGRATIONS=1

echo "db-verify: $BASE_LABEL ($(git rev-parse --short "$BASE_SHA")) → $HEAD_LABEL"

# ---------------------------------------------------------------- 1 drift

check_drift() {
  local dir=$WORK/drift rel rc=0 changes=$WORK/drift/changes.txt f
  mkdir -p "$dir"
  cp -R "$MIGRATIONS" "$dir/migrations"
  # same config as `pnpm db:generate` with `out` redirected to the copy; drizzle-kit prefixes `out`
  # with ./ so it must be relative to packages/db (the directory db:generate runs in)
  rel=$(node -e 'process.stdout.write(require("node:path").relative(process.argv[1], process.argv[2]))' \
    "$DB_PKG" "$dir/migrations")
  # shellcheck disable=SC2016 # a JavaScript template literal, not a shell expansion
  node -e 'require("node:fs").writeFileSync(process.argv[3],
    `import config from ${JSON.stringify(process.argv[1])};\nexport default { ...config, out: ${JSON.stringify(process.argv[2])} };\n`)' \
    "$DB_PKG/drizzle.config.ts" "$rel" "$dir/drizzle.config.ts"
  # no TTY (stdin from /dev/null): drizzle-kit 0.31 throws on a rename prompt; older versions waited
  # forever — hence the timeout. It exits 0 even on errors, so only its own "No schema changes"
  # line counts as a pass.
  (cd "$DB_PKG" && run_with_timeout "$GENERATE_TIMEOUT" "$DRIZZLE_KIT" generate --config="$dir/drizzle.config.ts") \
    </dev/null >"$dir/generate.log" 2>&1 || rc=$?

  : >"$changes"
  while IFS= read -r f; do
    f=${f#./}
    if [ ! -e "$MIGRATIONS/$f" ]; then
      echo "new      $MIGRATIONS_REL/$f" >>"$changes"
    elif ! cmp -s "$MIGRATIONS/$f" "$dir/migrations/$f"; then
      echo "changed  $MIGRATIONS_REL/$f" >>"$changes"
    fi
  done < <(cd "$dir/migrations" && find . -type f | LC_ALL=C sort)

  if [ -s "$changes" ]; then
    {
      cat "$changes"
      for f in "$dir"/migrations/*.sql; do
        [ -e "$f" ] && [ ! -e "$MIGRATIONS/$(basename "$f")" ] || continue
        echo "--- $(basename "$f") would contain:"
        head -n 40 "$f"
      done
    } >"$dir/detail.txt"
    record 1 drift FAIL "schema.ts changed without a migration — run \`pnpm db:generate\` locally and commit the result" \
      "$dir/detail.txt"
  elif timed_out "$rc"; then
    tail -n 20 "$dir/generate.log" >"$dir/detail.txt"
    record 1 drift FAIL "drizzle-kit generate still running after ${GENERATE_TIMEOUT}s (waiting on a prompt?) — run \`pnpm db:generate\` locally" \
      "$dir/detail.txt"
  elif grep -q "Interactive prompts require a TTY" "$dir/generate.log"; then
    grep -E "created or renamed|Interactive prompts" "$dir/generate.log" >"$dir/detail.txt" || true
    record 1 drift FAIL "schema.ts needs a rename decision — run \`pnpm db:generate\` locally, answer the prompt, commit the migration" \
      "$dir/detail.txt"
  elif [ "$rc" -eq 0 ] && grep -q "No schema changes" "$dir/generate.log"; then
    record 1 drift PASS "drizzle-kit generate: no schema changes"
  else
    tail -n 30 "$dir/generate.log" >"$dir/detail.txt"
    record 1 drift FAIL "drizzle-kit generate did not confirm \"No schema changes\" (exit $rc) — run \`pnpm db:generate\` locally" \
      "$dir/detail.txt"
  fi
}

# ---------------------------------------------------------------- 2 append-only

check_append_only() {
  local problems=$WORK/append-only.txt entry meta path blob count=0 base_journal=
  : >"$problems"
  if [ "$BASE_HAS_MIGRATIONS" = 1 ]; then
    # every deployed file except the journal (which may only grow) must be byte-identical today
    while IFS= read -r -d '' entry; do
      meta=${entry%%$'\t'*}
      path=${entry#*$'\t'}
      blob=${meta##* }
      [ "$path" = "$MIGRATIONS_REL/meta/_journal.json" ] && continue
      count=$((count + 1))
      if [ ! -e "$path" ]; then
        echo "deleted or renamed: $path (deployed in $BASE_LABEL)" >>"$problems"
      elif [ "$(git hash-object -- "$path")" != "$blob" ]; then
        echo "modified: $path (deployed in $BASE_LABEL) — never edit a deployed migration; add a new one" >>"$problems"
      fi
    done < <(git ls-tree -r -z "$BASE_SHA" -- "$MIGRATIONS_REL")
    base_journal=$WORK/base-journal.json
    git show "$BASE_SHA:$MIGRATIONS_REL/meta/_journal.json" >"$base_journal"
  fi
  # journal: base entries are an exact prefix · idx/when order · SQL + snapshot per entry · no orphans
  helper history "$MIGRATIONS" ${base_journal:+"$base_journal" "$BASE_LABEL"} >"$WORK/history.txt" 2>&1 ||
    sed 's/^  //' "$WORK/history.txt" >>"$problems"
  if [ -s "$problems" ]; then
    record 2 append-only FAIL "$(grep -c '' <"$problems" | tr -d ' ') problem line(s) against $BASE_LABEL" "$problems"
  elif [ "$BASE_HAS_MIGRATIONS" = 1 ]; then
    record 2 append-only PASS "$count deployed file(s) unchanged, $BASE_LABEL journal is a prefix, history well-formed"
  else
    record 2 append-only PASS "$BASE_LABEL has no migrations; history well-formed"
  fi
}

# ---------------------------------------------------------------- base checkout (for 3)

BASE_DIR=$WORK/base
BASE_DB_PKG=$BASE_DIR/$DB_REL
BASE_RUNNER=

# BASE_REF's packages/db with its own locked dependencies: production's data was written by that
# runner (drizzle-orm version, migrator.ts), not by HEAD's
prepare_base() {
  local files=() f store
  mkdir -p "$BASE_DIR" || return 1
  # every manifest + the lockfile: --frozen-lockfile needs all workspace importers to be present
  while IFS= read -r f; do files+=("$f"); done < <(git ls-tree -r --name-only "$BASE_SHA" |
    grep -E '(^|/)package\.json$|^pnpm-(lock|workspace)\.yaml$|^\.npmrc$|^\.pnpmfile\.cjs$')
  git archive --format=tar "$BASE_SHA" "${files[@]}" "$DB_REL" >"$WORK/base.tar" || return 1
  tar -x -C "$BASE_DIR" -f "$WORK/base.tar" || return 1
  store=$(pnpm store path) || return 1
  (cd "$BASE_DIR" && HUSKY=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0 run_with_timeout "$INSTALL_TIMEOUT" \
    pnpm install --frozen-lockfile --prefer-offline --ignore-scripts --filter "./$DB_REL" --store-dir "$store") \
    >"$WORK/base-install.log" 2>&1
}

script_of() {
  node -e 'const s = require(process.argv[1]).scripts?.[process.argv[2]]; if (!s) process.exit(1); process.stdout.write(s)' \
    "$1/package.json" "$2"
}

# base_step <migrate|seed> — BASE_REF's own package script (what its pre-deploy ran), run the way
# `pnpm run` runs it (sh -c, the package's node_modules/.bin first on PATH) without pnpm's startup
base_step() {
  local cmd
  cmd=$(script_of "$BASE_DB_PKG" "$1") || return 1
  (cd "$BASE_DB_PKG" && DATABASE_URL=$UP_URL PATH="$BASE_DB_PKG/node_modules/.bin:$PATH" sh -c "$cmd")
}

version_of() {
  node -p 'require(process.argv[1]).version' "$1/node_modules/drizzle-orm/package.json" 2>/dev/null || echo "?"
}

# ---------------------------------------------------------------- 3 upgrade path

UP_OK=0
UP_URL=
check_upgrade() {
  local log=$WORK/upgrade.txt base_seed=0 note=""
  : >"$log"
  if ! create_db "$UP_DB" 2>>"$log" || ! UP_URL=$(helper url "$UP_DB"); then
    record 3 "upgrade path" FAIL "could not create a scratch database" "$log"
    return
  fi
  if [ "$BASE_HAS_MIGRATIONS" = 1 ]; then
    if ! prepare_base; then
      tail -n 30 "$WORK/base-install.log" >>"$log"
      record 3 "upgrade path" FAIL "could not install $BASE_LABEL's packages/db (pnpm install --frozen-lockfile)" "$log"
      return
    fi
    if script_of "$BASE_DB_PKG" migrate >/dev/null; then
      BASE_RUNNER="$BASE_LABEL runner, drizzle-orm $(version_of "$BASE_DB_PKG")"
      base_step migrate >>"$log" 2>&1 || {
        record 3 "upgrade path" FAIL "$BASE_LABEL's own migrations do not apply to an empty database" "$log"
        return
      }
    else
      BASE_RUNNER="HEAD runner ($BASE_LABEL has no migrate script)"
      helper migrate "$UP_DB" "$BASE_DB_PKG/migrations" >>"$log" 2>&1 || {
        record 3 "upgrade path" FAIL "$BASE_LABEL's migrations do not apply to an empty database" "$log"
        return
      }
    fi
    helper applied "$UP_DB" "$BASE_DB_PKG/migrations" >>"$log" 2>&1 || {
      record 3 "upgrade path" FAIL "$BASE_LABEL's bookkeeping does not match its journal" "$log"
      return
    }
    if script_of "$BASE_DB_PKG" seed >/dev/null; then
      base_seed=1
      base_step seed >>"$log" 2>&1 || {
        record 3 "upgrade path" FAIL "$BASE_LABEL's seed failed on its own schema" "$log"
        return
      }
    else
      note=" (no base seed script)"
    fi
  else
    BASE_RUNNER="nothing deployed"
  fi

  echo "--- HEAD migrations on a database at $BASE_LABEL" >>"$log"
  helper migrate "$UP_DB" "$MIGRATIONS" >>"$log" 2>&1 || {
    record 3 "upgrade path" FAIL "HEAD's migrations fail on a database at $BASE_LABEL (production would stop at pre-deploy)" "$log"
    return
  }
  helper applied "$UP_DB" "$MIGRATIONS" --when-only >>"$log" 2>&1 || {
    record 3 "upgrade path" FAIL "after upgrading, a HEAD migration was skipped or applied twice (see journal \`when\`)" "$log"
    return
  }
  if [ "$base_seed" = 1 ]; then
    # Railway runs the pre-deploy while the previous release still serves traffic: its writes must
    # keep working on the new schema (expand–contract) — the seed is the write path we can replay
    echo "--- $BASE_LABEL seed on HEAD's schema (previous release still running)" >>"$log"
    base_step seed >>"$log" 2>&1 || {
      record 3 "upgrade path" FAIL "$BASE_LABEL's code can no longer write after HEAD's migrations — not backward compatible (expand, then contract in a later release)" "$log"
      return
    }
  fi
  helper seed "$UP_DB" >>"$log" 2>&1 || {
    record 3 "upgrade path" FAIL "HEAD's seed fails on the upgraded database" "$log"
    return
  }
  helper snapshot "$UP_DB" "$WORK/up" >>"$log" 2>&1 || {
    record 3 "upgrade path" FAIL "could not read the upgraded catalog" "$log"
    return
  }
  UP_OK=1
  record 3 "upgrade path" PASS "$BASE_LABEL ($BASE_RUNNER) → HEAD migrate; seeds old+new$note"
}

# ---------------------------------------------------------------- 4 fresh install + idempotency

FRESH_OK=0
check_fresh() {
  local log=$WORK/fresh.txt kind
  : >"$log"
  if ! create_db "$FRESH_DB" 2>>"$log"; then
    record 4 "fresh install" FAIL "could not create a scratch database" "$log"
    return
  fi
  helper migrate "$FRESH_DB" "$MIGRATIONS" >>"$log" 2>&1 || {
    record 4 "fresh install" FAIL "HEAD's migrations do not apply to an empty database" "$log"
    return
  }
  helper applied "$FRESH_DB" "$MIGRATIONS" >>"$log" 2>&1 || {
    record 4 "fresh install" FAIL "drizzle's bookkeeping does not match HEAD's journal" "$log"
    return
  }
  if ! { helper snapshot "$FRESH_DB" "$WORK/fresh-m1" && helper migrate "$FRESH_DB" "$MIGRATIONS" &&
    helper snapshot "$FRESH_DB" "$WORK/fresh-m2"; } >>"$log" 2>&1; then
    record 4 "fresh install" FAIL "second run of HEAD's migrations failed" "$log"
    return
  fi
  for kind in schema data applied; do
    diff_into "$WORK/fresh-m.diff" "after 1st migrate" "$WORK/fresh-m1.$kind.txt" "after 2nd migrate" \
      "$WORK/fresh-m2.$kind.txt" || {
      record 4 "fresh install" FAIL "second run of HEAD's migrations changed the database ($kind)" "$WORK/fresh-m.diff"
      return
    }
  done
  if ! { helper seed "$FRESH_DB" && helper snapshot "$FRESH_DB" "$WORK/fresh-s1" &&
    helper seed "$FRESH_DB" && helper snapshot "$FRESH_DB" "$WORK/fresh"; } >>"$log" 2>&1; then
    record 4 "fresh install" FAIL "the seed failed on a fresh database" "$log"
    return
  fi
  for kind in schema data; do
    diff_into "$WORK/fresh-s.diff" "after 1st seed" "$WORK/fresh-s1.$kind.txt" "after 2nd seed" \
      "$WORK/fresh.$kind.txt" || {
      record 4 "fresh install" FAIL "second seed changed the database ($kind) — seeds must be idempotent" "$WORK/fresh-s.diff"
      return
    }
  done
  FRESH_OK=1
  record 4 "fresh install" PASS "$(grep -c '' <"$WORK/fresh.applied.txt" | tr -d ' ') migrations; 2nd migrate and 2nd seed were no-ops"
}

# ---------------------------------------------------------------- 5 convergence

check_convergence() {
  local out=$WORK/convergence.diff
  if [ "$UP_OK" != 1 ] || [ "$FRESH_OK" != 1 ]; then
    record 5 convergence SKIP "needs checks 3 and 4"
    return
  fi
  if ! diff_into "$out" "upgraded from $BASE_LABEL" "$WORK/up.schema.txt" "fresh install" "$WORK/fresh.schema.txt"; then
    record 5 convergence FAIL "upgraded and fresh schemas differ — a migration behaves differently on an existing database" "$out"
  elif ! diff_into "$out" "upgraded from $BASE_LABEL" "$WORK/up.applied.txt" "fresh install" "$WORK/fresh.applied.txt"; then
    record 5 convergence FAIL "drizzle bookkeeping differs between upgraded and fresh databases" "$out"
  else
    record 5 convergence PASS "identical catalogs ($(grep -c '' <"$WORK/fresh.schema.txt" | tr -d ' ') lines, sha256 $(node -e \
      'process.stdout.write(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync(process.argv[1])).digest("hex").slice(0, 12))' \
      "$WORK/fresh.schema.txt")) and bookkeeping"
  fi
}

# ---------------------------------------------------------------- 6 canonical plpgsql

check_canonical() {
  local p=$WORK/canonical out=$WORK/canonical.diff log=$WORK/canonical.txt
  if [ "$FRESH_OK" != 1 ]; then
    record 6 "canonical plpgsql" SKIP "needs check 4"
    return
  fi
  if ! helper canonical "$FRESH_DB" "$FUNCTIONS_SQL" "$p" >"$log" 2>&1; then
    record 6 "canonical plpgsql" FAIL "packages/db/sql/functions.sql does not apply on top of HEAD's migrations" "$log"
  elif ! diff_into "$out" "deployed by migrations" "$p.before.txt" "after re-applying functions.sql" "$p.after.txt"; then
    record 6 "canonical plpgsql" FAIL "functions.sql and the migrations disagree — put the same definition in a new migration" "$out"
  elif ! diff_into "$out" "deployed by migrations" "$p.deployed.txt" "created by functions.sql alone" "$p.from-file.txt"; then
    record 6 "canonical plpgsql" FAIL "a deployed routine/trigger is missing from functions.sql (or differs when created from scratch)" "$out"
  else
    record 6 "canonical plpgsql" PASS "re-apply is a no-op; the file alone recreates $(grep -cE '\| (> CREATE|definition CREATE)' <"$p.deployed.txt" | tr -d ' ') routines/triggers"
  fi
}

# ---------------------------------------------------------------- run

check_drift
check_append_only
if SERVER=$(helper ping 2>"$WORK/ping.txt"); then
  echo "db-verify: $SERVER at TEST_DATABASE_URL"
  check_upgrade
  check_fresh
  check_convergence
  check_canonical
else
  for n in 3 4 5 6; do
    record "$n" "database checks" FAIL "cannot reach TEST_DATABASE_URL: $(head -n 1 "$WORK/ping.txt")"
  done
fi

# ---------------------------------------------------------------- summary

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### db-verify — $BASE_LABEL → $HEAD_LABEL"
    echo
    echo "| # | Check | Result | Detail |"
    echo "|---|-------|--------|--------|"
    for i in "${!IDS[@]}"; do
      printf '| %s | %s | **%s** | %s |\n' "${IDS[$i]}" "${TITLES[$i]}" "${STATUSES[$i]}" \
        "$(printf '%s' "${DETAILS[$i]}" | sed 's/|/\\|/g')"
    done
    for i in "${!IDS[@]}"; do
      if [ "${STATUSES[$i]}" = FAIL ] && [ -s "$WORK/detail-${IDS[$i]}.txt" ]; then
        printf '\n<details><summary>%s %s — detail</summary>\n\n```diff\n' "${IDS[$i]}" "${TITLES[$i]}"
        head -n 150 "$WORK/detail-${IDS[$i]}.txt"
        printf '```\n</details>\n'
      fi
    done
  } >>"$GITHUB_STEP_SUMMARY"
fi

if [ "$FAILED" = 1 ]; then
  echo "db-verify: FAILED — see the lines marked FAIL above"
  exit 1
fi
echo "db-verify: all checks passed"

#!/usr/bin/env bash
# db-verify — prove every database migration is safe to deploy (CI ring 0 · `make db-verify`).
#
#   1 drift              drizzle-kit generate against schema.ts creates or changes nothing
#   2 append-only        what any environment deployed is untouched: files, journal prefix, order,
#                        snapshot chain — against BASE_REF and every deployed branch tip
#   3 upgrade path       BASE_REF migrate + seed with its own code, then HEAD migrate, BASE_REF seed again
#                        (old code still serves while the new release boots), HEAD seed — and the same
#                        from the production branch when its packages/db differs from BASE_REF
#   4 fresh install      HEAD migrations twice (2nd = no-op) and the seed twice (2nd = no-op)
#   5 convergence        upgraded and fresh databases end with identical catalogs and bookkeeping
#   6 canonical plpgsql  re-applying packages/db/sql/functions.sql changes nothing, and the file alone
#                        recreates every deployed routine and trigger
#   7 schema.ts parity   the migrations build exactly what schema.ts declares (drizzle-kit push oracle)
#   8 expand-contract    migrations not deployed anywhere yet do not drop, rename or narrow what the
#                        previous release uses, nor rewrite existing rows — unless the migration says
#                        why:  -- db-verify: allow contract <reason>  /  -- db-verify: allow data-change <reason>
#
# Inputs
#   TEST_DATABASE_URL        admin connection (default postgres://ong:ong@localhost:5432/postgres) —
#                            scratch databases dbv_* are created on that server and dropped on exit
#   BASE_REF                 the release production runs (default: newest v* tag reachable from
#                            origin/main, else origin/main) — needs full history and tags
#                            (actions/checkout fetch-depth: 0)
#   DB_VERIFY_DEPLOYED_REFS  branch tips whose migrations are deployed somewhere (default
#                            "origin/main origin/staging origin/testing origin/dev"; "none" = only BASE_REF)
#   DB_VERIFY_PRODUCTION_REF what Railway production deploys (default origin/main; "none" to skip)
#   DB_VERIFY_KEEP=1         keep the scratch databases and work directory for debugging
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
[ -f "$MIGRATIONS/meta/_journal.json" ] || die "$MIGRATIONS_REL/meta/_journal.json not found"

# tsx listens on a socket under TMPDIR; a long TMPDIR exceeds the socket path limit on macOS
HELPER_TMPDIR=${TMPDIR:-/tmp}
[ ${#HELPER_TMPDIR} -le 60 ] || HELPER_TMPDIR=/tmp
helper() { TMPDIR=$HELPER_TMPDIR "$TSX" "$DB_PKG/src/ci/db-verify.ts" "$@"; }

# ---------------------------------------------------------------- timeouts and signals

# A step that may wait for input or hang runs under a timeout, in the background so that Ctrl-C and
# a CI cancel reach this shell at once (GNU timeout moves its command out of the terminal's process
# group); the signal trap then stops the step through timeout, which signals the step's whole group.
CHILD=
run_with_timeout() {
  local secs=$1 rc=0
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout --kill-after=10 "$secs" "$@" &
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout --kill-after=10 "$secs" "$@" &
  else
    perl -e 'alarm shift; exec @ARGV or die "exec $ARGV[0]: $!\n"' "$secs" "$@" &
  fi
  CHILD=$!
  wait "$CHILD" || rc=$?
  CHILD=
  return "$rc"
}
timed_out() { [ "$1" -eq 124 ] || [ "$1" -eq 137 ] || [ "$1" -eq 142 ]; }

# "${IN_DIR[@]}" <dir> <command…> — an executable prefix (timeout cannot run shell functions) that
# runs a command in another directory, so the step needs no subshell and CHILD stays visible
# shellcheck disable=SC2016 # expanded by the inner sh
IN_DIR=(sh -c 'cd "$0" && exec "$@"')

# ---------------------------------------------------------------- workspace + cleanup

WORK=$(mktemp -d "${TMPDIR:-/tmp}/db-verify.XXXXXX")
WORK=$(cd "$WORK" && pwd -P) # absolute even when TMPDIR is relative
RUN_ID="dbv_$(date +%Y%m%d%H%M%S)_$$_${RANDOM}"
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
    rm -rf "${WORK:?}"
  fi
  exit "$rc"
}
on_signal() {
  trap - INT TERM
  [ -z "$CHILD" ] || kill -TERM "$CHILD" 2>/dev/null || true
  exit "$1"
}
trap cleanup EXIT
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

create_db() {
  helper create "$1" && CREATED_DBS+=("$1")
}

# ---------------------------------------------------------------- results

IDS=()
TITLES=()
STATUSES=()
DETAILS=()
FAILED=0
ERRORED=0

CONNECTION_LOST='CONNECT_TIMEOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|too many clients|the database system is (starting up|shutting down|in recovery mode)|cannot connect now'

# record <id> <title> <PASS|FAIL|SKIP|ERROR> <one-line detail> [<file with more detail>]
# ERROR = could not be checked (environment), which exits 2 unless something also FAILed
record() {
  local id=$1 title=$2 status=$3 detail=$4 more=${5:-}
  # a lost connection is the environment's fault, not the migrations' — say so and exit 2
  if [ "$status" = FAIL ] && [ -n "$more" ] && [ -s "$more" ] && grep -qE "$CONNECTION_LOST" "$more"; then
    status=ERROR
    detail="PostgreSQL connection problem (environment, not the migrations) during: $detail"
  fi
  IDS+=("$id")
  TITLES+=("$title")
  STATUSES+=("$status")
  DETAILS+=("$detail")
  [ "$status" != FAIL ] || FAILED=1
  [ "$status" != ERROR ] || ERRORED=1
  printf '%-5s %s %-18s %s\n' "$status" "$id" "$title" "$detail"
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

lines() { grep -c '' <"$1" | tr -d ' '; }

# ---------------------------------------------------------------- refs

tree_of() { git rev-parse --verify --quiet "$1:$2" 2>/dev/null || true; }

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

# Every distinct deployed state of the migrations: BASE_REF plus each environment's branch tip
# (Railway deploys dev, testing, staging and main tips; main can carry untagged commits)
DEPLOYED_LABELS=()
DEPLOYED_SHAS=()
DEPLOYED_TREES=()
NOT_FOUND=()
add_deployed() {
  local ref=$1 sha tree i
  sha=$(git rev-parse --verify --quiet "${ref}^{commit}") || {
    NOT_FOUND+=("$ref")
    return 0
  }
  tree=$(tree_of "$sha" "$MIGRATIONS_REL")
  [ -n "$tree" ] || return 0
  for i in "${!DEPLOYED_TREES[@]}"; do
    if [ "${DEPLOYED_TREES[$i]}" = "$tree" ]; then
      DEPLOYED_LABELS[i]="${DEPLOYED_LABELS[$i]}, $ref" # labels never contain "=" (label=file below)
      return 0
    fi
  done
  DEPLOYED_LABELS+=("$ref")
  DEPLOYED_SHAS+=("$sha")
  DEPLOYED_TREES+=("$tree")
}
add_deployed "$BASE_REF"
deployed_refs=${DB_VERIFY_DEPLOYED_REFS:-origin/main origin/staging origin/testing origin/dev}
[ "$deployed_refs" != none ] || deployed_refs=
for ref in $deployed_refs; do add_deployed "$ref"; done

# the production branch gets its own upgrade run when its packages/db is not BASE_REF's
UPGRADE_LABELS=("$BASE_LABEL")
UPGRADE_SHAS=("$BASE_SHA")
production_ref=${DB_VERIFY_PRODUCTION_REF:-origin/main}
[ "$production_ref" != none ] || production_ref=
if [ -n "$production_ref" ] && production_sha=$(git rev-parse --verify --quiet "${production_ref}^{commit}"); then
  if [ "$(tree_of "$production_sha" "$DB_REL")" != "$(tree_of "$BASE_SHA" "$DB_REL")" ]; then
    UPGRADE_LABELS+=("$production_ref")
    UPGRADE_SHAS+=("$production_sha")
  fi
fi

journal_len() {
  node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(s ? JSON.parse(s).entries.length : 0))'
}
N_BASE=$( (git show "$BASE_SHA:$MIGRATIONS_REL/meta/_journal.json" 2>/dev/null || true) | journal_len)
N_DEPLOYED=0

echo "db-verify: $BASE_LABEL ($(git rev-parse --short "$BASE_SHA")) → $HEAD_LABEL"
[ ${#DEPLOYED_LABELS[@]} -eq 0 ] || printf 'db-verify: deployed migration states: %s\n' "$(printf '[%s] ' "${DEPLOYED_LABELS[@]}")"
[ ${#NOT_FOUND[@]} -eq 0 ] || echo "db-verify: not found, not checked: ${NOT_FOUND[*]}"

# ---------------------------------------------------------------- 1 drift

check_drift() {
  local dir=$WORK/drift rel rc=0 changes=$WORK/drift/changes.txt f
  mkdir -p "$dir/migrations"
  # the files git knows (tracked or new, not ignored): a stray .DS_Store must not change the verdict
  while IFS= read -r -d '' f; do
    [ -f "$f" ] || continue
    mkdir -p "$dir/migrations/$(dirname "${f#"$MIGRATIONS_REL"/}")"
    cp "$f" "$dir/migrations/${f#"$MIGRATIONS_REL"/}"
  done < <(git ls-files -z -co --exclude-standard -- "$MIGRATIONS_REL")
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
  run_with_timeout "$GENERATE_TIMEOUT" "${IN_DIR[@]}" "$DB_PKG" "$DRIZZLE_KIT" generate --config="$dir/drizzle.config.ts" \
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
  local problems=$WORK/append-only.txt i sha label entry meta path blob specs=() out states="" n rc=0
  : >"$problems"
  for i in "${!DEPLOYED_SHAS[@]}"; do
    sha=${DEPLOYED_SHAS[$i]}
    label=${DEPLOYED_LABELS[$i]}
    n=0
    # every deployed file except the journal (which may only grow) must be byte-identical today
    while IFS= read -r -d '' entry; do
      meta=${entry%%$'\t'*}
      path=${entry#*$'\t'}
      blob=${meta##* }
      [ "$path" != "$MIGRATIONS_REL/meta/_journal.json" ] || continue
      n=$((n + 1))
      if [ ! -e "$path" ]; then
        echo "deleted or renamed: $path (deployed in $label)"
      elif [ "$(git hash-object -- "$path")" != "$blob" ]; then
        echo "modified: $path (deployed in $label) — never edit a deployed migration; add a new one"
      fi
    done < <(git ls-tree -r -z "$sha" -- "$MIGRATIONS_REL") >>"$problems"
    git show "$sha:$MIGRATIONS_REL/meta/_journal.json" >"$WORK/deployed-$i.json"
    specs+=("$label=$WORK/deployed-$i.json")
    states="$states${states:+ · }$label ($n files)"
  done
  # journal: each deployed journal is an exact prefix · idx/tag/when order · SQL + snapshot per
  # entry · no orphans · one snapshot chain; prints how many entries are deployed somewhere
  out=$(helper history "$MIGRATIONS" ${specs[@]+"${specs[@]}"} 2>"$WORK/history.err") || rc=$?
  [ "$rc" -eq 0 ] || cat "$WORK/history.err" >>"$problems" # a runtime warning alone is not a problem
  N_DEPLOYED=$(printf '%s\n' "$out" | awk '$1 == "deployed" { print $2 }')
  N_DEPLOYED=${N_DEPLOYED:-0}
  if [ -s "$problems" ] || [ "$rc" -ne 0 ]; then
    record 2 append-only FAIL "$(grep -c '^[^ ]' <"$problems" | tr -d ' ') problem(s) against the deployed history" "$problems"
  elif [ -n "$states" ]; then
    record 2 append-only PASS "unchanged in HEAD: $states; journals are prefixes, history well-formed"
  else
    record 2 append-only PASS "nothing deployed yet; history well-formed"
  fi
}

# ---------------------------------------------------------------- base checkouts (for 3)

# A deployed ref's packages/db with its own locked dependencies: its data was written by that
# runner (drizzle-orm version, migrator.ts) and that seed, not by HEAD's
prepare_base() {
  local sha=$1 dir=$2 files=() f store
  mkdir -p "$dir" || return 1
  # every manifest + the lockfile: --frozen-lockfile needs all workspace importers to be present
  while IFS= read -r f; do files+=("$f"); done < <(git ls-tree -r --name-only "$sha" |
    grep -E '(^|/)package\.json$|^pnpm-(lock|workspace)\.yaml$|^\.npmrc$|^\.pnpmfile\.cjs$')
  git archive --format=tar "$sha" "${files[@]}" "$DB_REL" >"$dir.tar" || return 1
  tar -x -C "$dir" -f "$dir.tar" || return 1
  store=$(pnpm store path) || return 1
  # NODE_ENV=production would skip devDependencies (tsx) and make the base runner look broken
  run_with_timeout "$INSTALL_TIMEOUT" env HUSKY=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NODE_ENV=development \
    "${IN_DIR[@]}" "$dir" pnpm install --frozen-lockfile --prefer-offline --ignore-scripts --filter "./$DB_REL" \
    --store-dir "$store" >"$dir.install.log" 2>&1
}

script_of() {
  node -e 'const s = require(process.argv[1]).scripts?.[process.argv[2]]; if (!s) process.exit(1); process.stdout.write(s)' \
    "$1/package.json" "$2"
}

# base_step <base dir> <migrate|seed> <database url> — that ref's own package script (what its
# pre-deploy ran), run the way `pnpm run` runs it: sh -c, the package's node_modules/.bin first
base_step() {
  local pkg=$1/$DB_REL cmd
  cmd=$(script_of "$pkg" "$2") || return 1
  (cd "$pkg" && DATABASE_URL=$3 PATH="$pkg/node_modules/.bin:$PATH" sh -c "$cmd")
}

version_of() {
  node -p 'require(process.argv[1]).version' "$1/node_modules/drizzle-orm/package.json" 2>/dev/null || echo "?"
}

# ---------------------------------------------------------------- 3 upgrade path

UPGRADE_RUNNER=()
UPGRADE_ERROR=()

# upgrade_from <index> — output goes to the caller's log; sets UPGRADE_RUNNER/UPGRADE_ERROR
upgrade_from() {
  local i=$1 label=${UPGRADE_LABELS[$1]} sha=${UPGRADE_SHAS[$1]} dir=$WORK/base-$1 db=${RUN_ID}_up$1 url base_seed=0
  UPGRADE_RUNNER[i]="nothing deployed"
  echo "=== upgrade from $label"
  if ! create_db "$db" || ! url=$(helper url "$db"); then
    UPGRADE_ERROR[i]="could not create a scratch database"
    return 1
  fi
  if [ -n "$(tree_of "$sha" "$MIGRATIONS_REL")" ]; then
    if ! prepare_base "$sha" "$dir"; then
      tail -n 30 "$dir.install.log" 2>/dev/null
      UPGRADE_ERROR[i]="could not install $label's packages/db (pnpm install --frozen-lockfile)"
      return 1
    fi
    if script_of "$dir/$DB_REL" migrate >/dev/null; then
      UPGRADE_RUNNER[i]="its own runner, drizzle-orm $(version_of "$dir/$DB_REL")"
      base_step "$dir" migrate "$url" || {
        UPGRADE_ERROR[i]="$label's own migrations do not apply to an empty database"
        return 1
      }
    else
      UPGRADE_RUNNER[i]="HEAD's runner — $label has no migrate script"
      helper migrate "$db" "$dir/$DB_REL/migrations" || {
        UPGRADE_ERROR[i]="$label's migrations do not apply to an empty database"
        return 1
      }
    fi
    helper applied "$db" "$dir/$DB_REL/migrations" || {
      UPGRADE_ERROR[i]="$label's bookkeeping does not match its journal"
      return 1
    }
    if script_of "$dir/$DB_REL" seed >/dev/null; then
      base_seed=1
      base_step "$dir" seed "$url" || {
        UPGRADE_ERROR[i]="$label's seed failed on its own schema"
        return 1
      }
    fi
  fi
  helper snapshot "$db" "$WORK/up$i-base" || {
    UPGRADE_ERROR[i]="could not read the catalog at $label"
    return 1
  }
  echo "--- HEAD migrations on a database at $label"
  helper migrate "$db" "$MIGRATIONS" || {
    UPGRADE_ERROR[i]="HEAD's migrations fail on a database at $label (production would stop at pre-deploy)"
    return 1
  }
  helper applied "$db" "$MIGRATIONS" --when-only || {
    UPGRADE_ERROR[i]="after upgrading from $label, a HEAD migration was skipped or applied twice (journal \`when\`)"
    return 1
  }
  if [ "$base_seed" = 1 ]; then
    # Railway runs the pre-deploy while the previous release still serves traffic: its writes must
    # keep working on the new schema (expand–contract) — the seed is the write path we can replay
    echo "--- $label seed on HEAD's schema (previous release still running)"
    base_step "$dir" seed "$url" || {
      UPGRADE_ERROR[i]="$label's code can no longer write after HEAD's migrations — not backward compatible (expand now, contract in a later release)"
      return 1
    }
  fi
  helper seed "$db" || {
    UPGRADE_ERROR[i]="HEAD's seed fails on a database upgraded from $label"
    return 1
  }
  helper snapshot "$db" "$WORK/up$i" || {
    UPGRADE_ERROR[i]="could not read the upgraded catalog"
    return 1
  }
}

check_upgrade() {
  local log=$WORK/upgrade.txt i failed=0 summary="" api db
  : >"$log"
  # production runs apps/api's bundle, which resolves drizzle-orm from apps/api; db-verify runs
  # packages/db's — they must be the same runner
  api=$(version_of "$REPO_ROOT/apps/api")
  db=$(version_of "$DB_PKG")
  if [ "$api" != "?" ] && [ "$api" != "$db" ]; then
    echo "production's migrate bundle (apps/api) resolves drizzle-orm $api but packages/db has $db — align them" >>"$log"
    failed=1
    summary="drizzle-orm differs between apps/api ($api) and packages/db ($db)"
  fi
  for i in "${!UPGRADE_SHAS[@]}"; do
    if upgrade_from "$i" >>"$log" 2>&1; then
      summary="$summary${summary:+ · }${UPGRADE_LABELS[$i]} (${UPGRADE_RUNNER[$i]}) → HEAD, seeds old+new"
    else
      failed=1
      summary="$summary${summary:+ · }${UPGRADE_ERROR[$i]}"
    fi
  done
  if [ "$failed" = 1 ]; then
    record 3 "upgrade path" FAIL "$summary" "$log"
  else
    record 3 "upgrade path" PASS "$summary"
  fi
}

# ---------------------------------------------------------------- 4 fresh install + idempotency

FRESH_OK=0
check_fresh() {
  local log=$WORK/fresh.txt kind
  : >"$log"
  if ! create_db "$FRESH_DB" 2>>"$log"; then
    record 4 "fresh install" ERROR "could not create a scratch database" "$log"
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
  record 4 "fresh install" PASS "$(lines "$WORK/fresh.applied.txt") migrations; 2nd migrate and 2nd seed were no-ops"
}

# ---------------------------------------------------------------- 5 convergence

check_convergence() {
  local out=$WORK/convergence.diff i compared=""
  if [ "$FRESH_OK" != 1 ]; then
    record 5 convergence SKIP "needs check 4"
    return
  fi
  for i in "${!UPGRADE_SHAS[@]}"; do
    [ -f "$WORK/up$i.schema.txt" ] || continue
    if ! diff_into "$out" "upgraded from ${UPGRADE_LABELS[$i]}" "$WORK/up$i.schema.txt" "fresh install" "$WORK/fresh.schema.txt"; then
      record 5 convergence FAIL "upgraded (from ${UPGRADE_LABELS[$i]}) and fresh schemas differ — a migration behaves differently on an existing database" "$out"
      return
    fi
    if ! diff_into "$out" "upgraded from ${UPGRADE_LABELS[$i]}" "$WORK/up$i.applied.txt" "fresh install" "$WORK/fresh.applied.txt"; then
      record 5 convergence FAIL "drizzle bookkeeping differs between the database upgraded from ${UPGRADE_LABELS[$i]} and a fresh one" "$out"
      return
    fi
    compared="$compared${compared:+, }${UPGRADE_LABELS[$i]}"
  done
  if [ -z "$compared" ]; then
    record 5 convergence SKIP "needs check 3"
    return
  fi
  record 5 convergence PASS "upgraded from $compared = fresh: identical catalogs ($(lines "$WORK/fresh.schema.txt") lines, sha256 $(node -e \
    'process.stdout.write(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync(process.argv[1])).digest("hex").slice(0, 12))' \
    "$WORK/fresh.schema.txt")) and bookkeeping"
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
    record 6 "canonical plpgsql" PASS "re-apply is a no-op; the file alone recreates all $(grep -cE '\| (> CREATE|definition CREATE)' <"$p.from-file.txt" | tr -d ' ') routines/triggers"
  fi
}

# ---------------------------------------------------------------- 7 schema.ts parity

check_parity() {
  local log=$WORK/parity.txt out=$WORK/parity.diff db=${RUN_ID}_push url rc=0
  : >"$log"
  if [ "$FRESH_OK" != 1 ]; then
    record 7 "schema.ts parity" SKIP "needs check 4"
    return
  fi
  if ! create_db "$db" 2>>"$log" || ! url=$(helper url "$db"); then
    record 7 "schema.ts parity" ERROR "could not create a scratch database" "$log"
    return
  fi
  # schema.ts built directly by drizzle-kit (the oracle) vs the database the migrations built:
  # a hand-written or edited migration that disagrees with schema.ts passes checks 1–6
  # shellcheck disable=SC2016 # a JavaScript template literal, not a shell expansion
  node -e 'require("node:fs").writeFileSync(process.argv[3],
    `import config from ${JSON.stringify(process.argv[1])};\nexport default { ...config, dbCredentials: { url: ${JSON.stringify(process.argv[2])} }, strict: false, verbose: false };\n`)' \
    "$DB_PKG/drizzle.config.ts" "$url" "$WORK/push.config.ts"
  run_with_timeout "$GENERATE_TIMEOUT" "${IN_DIR[@]}" "$DB_PKG" "$DRIZZLE_KIT" push --config="$WORK/push.config.ts" --force \
    </dev/null >"$WORK/push.log" 2>&1 || rc=$?
  if ! grep -q "Changes applied" "$WORK/push.log"; then
    tail -n 30 "$WORK/push.log" >>"$log"
    record 7 "schema.ts parity" FAIL "drizzle-kit push could not build schema.ts into an empty database (exit $rc)" "$log"
    return
  fi
  if ! helper snapshot "$db" "$WORK/push" >>"$log" 2>&1; then
    record 7 "schema.ts parity" ERROR "could not read the catalog built from schema.ts" "$log"
  elif diff_into "$out" "built by the migrations" "$WORK/fresh.structure.txt" "declared by schema.ts (drizzle-kit push)" \
    "$WORK/push.structure.txt"; then
    record 7 "schema.ts parity" PASS "the migrations build exactly what schema.ts declares ($(lines "$WORK/push.structure.txt") lines compared)"
  else
    record 7 "schema.ts parity" FAIL "the migrations do not build what schema.ts declares — a hand-written or edited migration disagrees with it" "$out"
  fi
}

# ---------------------------------------------------------------- 8 expand-contract

check_contract() {
  local log=$WORK/contract.txt report=$WORK/contract-pending.txt detail=$WORK/contract-detail.txt
  local db=${RUN_ID}_prefix before=$WORK/prefix.entries.json tags=() tag i files=() pending=() rc=0
  : >"$log"
  : >"$detail"
  if [ "$FRESH_OK" != 1 ]; then
    record 8 expand-contract SKIP "needs check 4"
    return
  fi
  while IFS= read -r tag; do tags+=("$tag"); done < <(node -e \
    'for (const e of require(process.argv[1]).entries) console.log(e.tag)' "$MIGRATIONS/meta/_journal.json")
  i=0
  for tag in ${tags[@]+"${tags[@]}"}; do
    if [ "$i" -ge "$N_DEPLOYED" ]; then
      files+=("$MIGRATIONS/$tag.sql")
    elif [ "$i" -ge "$N_BASE" ]; then
      pending+=("$MIGRATIONS/$tag.sql")
    fi
    i=$((i + 1))
  done

  if [ ${#files[@]} -gt 0 ]; then
    # the catalog as the newest deployed release left it vs HEAD's — only this PR's migrations
    if [ "$N_DEPLOYED" -eq 0 ]; then
      echo "[]" >"$before"
    elif ! { create_db "$db" && helper migrate "$db" "$MIGRATIONS" --entries "$N_DEPLOYED" &&
      helper snapshot "$db" "$WORK/prefix"; } >>"$log" 2>&1; then
      record 8 expand-contract ERROR "could not build the deployed state ($N_DEPLOYED migrations)" "$log"
      return
    fi
    helper contract "$before" "$WORK/fresh.entries.json" "${files[@]}" >"$WORK/contract-new.txt" 2>&1 || rc=$?
    cat "$WORK/contract-new.txt" >>"$detail"
  fi

  # migrations already deployed to an environment but not in BASE_REF: they reach production at
  # the next promotion — shown for the promotion PR, not failed (they were checked when merged)
  if [ ${#pending[@]} -gt 0 ] && [ -f "$WORK/up0-base.entries.json" ]; then
    local mid=$WORK/fresh.entries.json
    [ ${#files[@]} -eq 0 ] || mid=$before
    if helper contract --report "$WORK/up0-base.entries.json" "$mid" "${pending[@]}" >"$report" 2>&1 && [ -s "$report" ]; then
      {
        echo "pending for $BASE_LABEL (already deployed elsewhere, reach production at the next promotion):"
        sed 's/^/  /' "$report"
      } >>"$detail"
    fi
  fi

  if [ ${#files[@]} -eq 0 ]; then
    record 8 expand-contract PASS "no migration beyond what is already deployed" "$detail"
  elif [ "$rc" -ne 0 ]; then
    record 8 expand-contract FAIL "a new migration drops, renames, narrows or rewrites what the previous release uses — expand now, contract later, or add '-- db-verify: allow <contract|data-change> <reason>'" "$detail"
  else
    record 8 expand-contract PASS "${#files[@]} new migration(s) only expand the schema$([ -s "$WORK/contract-new.txt" ] && echo " (acknowledged changes listed)")" "$detail"
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
  check_parity
  check_contract
else
  reason=$(tr '\n' ' ' <"$WORK/ping.txt" | sed 's/  */ /g')
  for n in 3 4 5 6 7 8; do
    record "$n" "database checks" ERROR "cannot reach TEST_DATABASE_URL: ${reason:-no answer}"
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
      if [ -s "$WORK/detail-${IDS[$i]}.txt" ]; then
        printf '\n<details><summary>%s %s — %s</summary>\n\n```diff\n' "${IDS[$i]}" "${TITLES[$i]}" "${STATUSES[$i]}"
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
if [ "$ERRORED" = 1 ]; then
  echo "db-verify: could not run every check (ERROR above)"
  exit 2
fi
echo "db-verify: all checks passed"

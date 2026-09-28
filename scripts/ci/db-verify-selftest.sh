#!/usr/bin/env bash
# Negative controls for scripts/ci/db-verify.sh: in a throwaway clone of HEAD, make one known-bad
# change at a time and assert that the check meant to catch it fails — and that the untouched tree
# passes. Tests the db-verify in your working tree (script + packages/db/src/ci) against HEAD's
# migrations. One full db-verify run per control (~40 s each): run it after changing db-verify or
# when Renovate bumps drizzle-orm / drizzle-kit.
#
#   scripts/ci/db-verify-selftest.sh              every control
#   scripts/ci/db-verify-selftest.sh drift when   only the named controls
#
# Needs what db-verify needs (TEST_DATABASE_URL, full history + tags). Exit 0 = every control
# behaved as expected.
set -euo pipefail

cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
REPO_ROOT=$PWD
command -v perl >/dev/null 2>&1 || {
  echo "db-verify-selftest: perl not found" >&2
  exit 2
}

if [ -z "${BASE_REF:-}" ]; then
  BASE_REF=$(git describe --tags --abbrev=0 --match 'v*' origin/main 2>/dev/null || echo origin/main)
fi
BASE_SHA=$(git rev-parse --verify --quiet "${BASE_REF}^{commit}") || {
  echo "db-verify-selftest: BASE_REF '$BASE_REF' not found" >&2
  exit 2
}
export BASE_REF
# pnpm may be configured with a per-directory store: reuse this checkout's for the base install
npm_config_store_dir=$(pnpm store path)
export npm_config_store_dir

SCRATCH=$(mktemp -d "${TMPDIR:-/tmp}/db-verify-selftest.XXXXXX")
T=$SCRATCH/tree
trap 'rm -rf "$SCRATCH"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# a clone, not a worktree: nothing is registered in the shared repository
git clone -q --shared --no-checkout "$REPO_ROOT" "$T"
git -C "$T" -c advice.detachedHead=false checkout -q "$(git rev-parse HEAD)"
# the clone has the tags; a branch name like origin/main means something else there — pin the commit
git -C "$T" rev-parse --verify --quiet "${BASE_REF}^{commit}" >/dev/null || BASE_REF=$BASE_SHA
ln -s "$REPO_ROOT/packages/db/node_modules" "$T/packages/db/node_modules"
DB=$T/packages/db
KIT=$DB/node_modules/.bin/drizzle-kit

# the tool under test comes from the working tree; everything else is HEAD
install_tool() {
  cp "$REPO_ROOT/scripts/ci/db-verify.sh" "$T/scripts/ci/db-verify.sh"
  rm -rf "$DB/src/ci"
  cp -R "$REPO_ROOT/packages/db/src/ci" "$DB/src/ci"
}

reset_tree() {
  git -C "$T" checkout -q -- .
  git -C "$T" clean -qfd -- packages/db/migrations packages/db/src packages/db/sql
  install_tool
}

# the changes must really apply — a control that changes nothing proves nothing
changed() {
  [ -n "$(git -C "$T" status --porcelain -- packages/db ':!packages/db/src/ci')" ] || {
    echo "control did not change anything: $*" >&2
    return 1
  }
}

last_tag() {
  node -e 'const j = require(process.argv[1]); process.stdout.write(j.entries.at(-1).tag)' \
    "$DB/migrations/meta/_journal.json"
}

# custom_migration <name> <sql> — how a developer adds hand-written SQL (drizzle-kit generate --custom)
custom_migration() {
  (cd "$DB" && "$KIT" generate --custom --name "$1" </dev/null >/dev/null 2>&1)
  printf '%s\n' "$2" >"$DB/migrations/$(last_tag).sql"
}

generate() {
  (cd "$DB" && "$KIT" generate --name "$1" </dev/null >/dev/null 2>&1)
}

# ---------------------------------------------------------------- controls

ALL="baseline edit_deployed drift rename functions_only function_missing divergent when not_null contract"

# expect <control> — the checks that must FAIL ("" = every check must pass)
expect() {
  case $1 in
    baseline) echo "" ;;
    edit_deployed) echo "2 5" ;;
    drift | rename) echo "1" ;;
    functions_only | function_missing) echo "6" ;;
    divergent) echo "5" ;;
    when) echo "2 3" ;;
    not_null | contract) echo "3" ;;
    *) return 1 ;;
  esac
}

# mutate <control> — make the known-bad change in the clone
mutate() {
  local first
  case $1 in
    baseline) ;;
    edit_deployed) # a deployed migration edited in place: production never re-runs it
      first=$(git show "$BASE_SHA:packages/db/migrations/meta/_journal.json" |
        node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => process.stdout.write(JSON.parse(s).entries[0].tag))')
      printf '%s\n' '--> statement-breakpoint' 'CREATE TABLE "nc_edited" ("id" integer);' >>"$DB/migrations/$first.sql"
      changed "append to $first.sql"
      ;;
    drift) # schema.ts changed, pnpm db:generate forgotten
      printf '\n%s\n' 'export const ncDrift = pgTable("nc_drift", { id: integer("id").primaryKey() });' >>"$DB/src/schema.ts"
      changed "add a table to schema.ts"
      ;;
    rename) # a rename drizzle-kit can only resolve by asking (no TTY in CI)
      printf '\n%s\n' 'export const ncRename = pgTable("nc_rename", { id: integer("id").primaryKey(), oldName: text("old_name") });' \
        >>"$DB/src/schema.ts"
      generate nc_rename
      perl -pi -e 's/oldName: text\("old_name"\)/newName: text("new_name")/' "$DB/src/schema.ts"
      changed "rename a column without generating"
      ;;
    functions_only) # canonical plpgsql edited without a migration
      perl -0pi -e 's/\bBEGIN\b/BEGIN\n  -- db-verify self-test: edited only in functions.sql/' "$DB/sql/functions.sql"
      changed "edit a function body in functions.sql only"
      ;;
    function_missing) # a routine deployed by a migration but absent from functions.sql
      custom_migration nc_function \
        'CREATE OR REPLACE FUNCTION nc_only_in_migration() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;'
      changed "a function created only by a migration"
      ;;
    divergent) # DDL that depends on existing rows: production and a fresh install end up different
      custom_migration nc_divergent 'DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM branch) THEN
    CREATE TABLE nc_diverge (id integer);
  END IF;
END $$;'
      changed "a migration that depends on existing rows"
      ;;
    when) # generated on an older branch, merged later: the runner skips it on existing databases
      custom_migration nc_when 'CREATE TABLE nc_when (id integer);'
      node -e 'const fs = require("fs"); const f = process.argv[1]; const j = JSON.parse(fs.readFileSync(f, "utf8"));
        j.entries.at(-1).when = j.entries.at(-2).when - 1; fs.writeFileSync(f, JSON.stringify(j, null, 2))' \
        "$DB/migrations/meta/_journal.json"
      changed "a new migration older than the previous one"
      ;;
    not_null) # fine on an empty database, fails on production's rows
      perl -0pi -e 's/(export const branch = pgTable\("branch", \{\n)/$1  ncRequired: text("nc_required").notNull(),\n/' \
        "$DB/src/schema.ts"
      generate nc_not_null
      changed "NOT NULL column without default on a table that has rows"
      ;;
    contract) # drops a column the previous release still writes during the deploy
      perl -0pi -e 's/\n[ \t]*sortOrder: integer\("sort_order"\)[^\n]*//' "$DB/src/schema.ts"
      generate nc_contract
      changed "drop a column the previous release still writes"
      ;;
  esac
}

SELECTED=${*:-$ALL}

# ---------------------------------------------------------------- run

printf '%-18s %-7s %-14s %s\n' control expect "got 1-6" result
bad=0
for name in $SELECTED; do
  want=$(expect "$name") || {
    echo "unknown control: $name (have: $ALL)" >&2
    exit 2
  }
  reset_tree
  log=$SCRATCH/$name.log
  if ! mutate "$name" >"$log" 2>&1; then
    printf '%-18s %-7s %-14s %s\n' "$name" "${want:--}" "-" "SETUP FAILED"
    sed 's/^/    /' "$log"
    bad=1
    continue
  fi
  rc=0
  "$T/scripts/ci/db-verify.sh" >>"$log" 2>&1 || rc=$?
  got=""
  failed=" "
  for n in 1 2 3 4 5 6; do
    s=$(awk -v n="$n" '$1 ~ /^(PASS|FAIL|SKIP)$/ && $2 == n { print $1; exit }' "$log")
    got="$got ${s:0:1}"
    [ "$s" = FAIL ] && failed="$failed$n "
  done
  ok=1
  if [ -z "$want" ]; then
    [ "$rc" -eq 0 ] && [ "$failed" = " " ] || ok=0
  else
    [ "$rc" -eq 1 ] || ok=0
    for n in $want; do
      case "$failed" in *" $n "*) ;; *) ok=0 ;; esac
    done
  fi
  if [ "$ok" = 1 ]; then result=ok; else result="UNEXPECTED (exit $rc)"; bad=1; fi
  printf '%-18s %-7s %-14s %s\n' "$name" "${want:--}" "$got" "$result"
  if [ "$ok" != 1 ] || [ "${DB_VERIFY_SELFTEST_VERBOSE:-0}" = 1 ]; then
    awk '/^(PASS|FAIL|SKIP)  [1-6] |^      / && shown++ < 60 { print "    " $0 }' "$log"
  fi
done
exit "$bad"

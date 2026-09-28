#!/usr/bin/env bash
# Negative controls for scripts/ci/db-verify.sh: in a throwaway clone of HEAD, make one known-bad
# change at a time and assert that the check meant to catch it fails (and, where it matters, that
# the checks which could not see it still pass) — and that the untouched tree passes. Tests the
# db-verify in your working tree (script + packages/db/src/ci) against HEAD's migrations. One full
# db-verify run per control (~1 min each): run it after changing db-verify or when Renovate bumps
# drizzle-orm / drizzle-kit (`make db-verify-test`).
#
#   scripts/ci/db-verify-selftest.sh              every control
#   scripts/ci/db-verify-selftest.sh drift when   only the named controls
#
# Needs what db-verify needs (TEST_DATABASE_URL, full history + tags). Exit 0 = every control
# behaved as expected. The baseline must pass on the subject: when HEAD itself fails db-verify (a real
# finding), test the tool on another commit with DB_VERIFY_SELFTEST_REF=<commit>.
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
HEAD_SHA=$(git rev-parse --verify --quiet "${DB_VERIFY_SELFTEST_REF:-HEAD}^{commit}") || {
  echo "db-verify-selftest: DB_VERIFY_SELFTEST_REF '${DB_VERIFY_SELFTEST_REF:-}' not found" >&2
  exit 2
}
export BASE_REF
# deterministic: the committed migrations count as deployed (in CI origin/dev holds them), so each
# control's own change is what is new; controls that need other deployed tips add them below
export DB_VERIFY_DEPLOYED_REFS=$HEAD_SHA DB_VERIFY_PRODUCTION_REF=none
# pnpm may be configured with a per-directory store: reuse this checkout's for the base install
npm_config_store_dir=$(pnpm store path)
export npm_config_store_dir

SCRATCH=$(mktemp -d "${TMPDIR:-/tmp}/db-verify-selftest.XXXXXX")
T=$SCRATCH/tree
trap 'rm -rf "${SCRATCH:?}"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# a clone, not a worktree: nothing is registered in the shared repository
git clone -q --shared --no-checkout "$REPO_ROOT" "$T"
git -C "$T" -c advice.detachedHead=false checkout -q "$HEAD_SHA"
# the clone has the tags; a branch name like origin/main means something else there — pin the commit
git -C "$T" rev-parse --verify --quiet "${BASE_REF}^{commit}" >/dev/null || BASE_REF=$BASE_SHA
DB=$T/packages/db
link_modules() { [ -e "$DB/node_modules" ] || ln -s "$REPO_ROOT/packages/db/node_modules" "$DB/node_modules"; }
link_modules
KIT=$DB/node_modules/.bin/drizzle-kit

# the tool under test comes from the working tree; everything else is HEAD
install_tool() {
  cp "$REPO_ROOT/scripts/ci/db-verify.sh" "$T/scripts/ci/db-verify.sh"
  rm -rf "$DB/src/ci"
  cp -R "$REPO_ROOT/packages/db/src/ci" "$DB/src/ci"
}

reset_tree() {
  local ref
  git -C "$T" -c advice.detachedHead=false checkout -q -f "$HEAD_SHA"
  git -C "$T" clean -qfd -- packages/db/migrations packages/db/src packages/db/sql
  while IFS= read -r ref; do git -C "$T" update-ref -d "$ref"; done < <(git -C "$T" for-each-ref --format='%(refname)' 'refs/heads/nc-*')
  rm -rf "${T:?}/apps/api/node_modules"
  link_modules
  install_tool
}

# the changes must really apply — a control that changes nothing proves nothing
changed() {
  [ -n "$(git -C "$T" status --porcelain -- packages/db ':!packages/db/src/ci' ':!packages/db/node_modules')" ] || {
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

# deploy_as <branch> — commit packages/db as that branch tip in the clone (what an environment runs)
deploy_as() {
  # the node_modules link is a symlink, which the ignore rule `node_modules/` (directories) misses
  git -C "$T" add -A -- packages/db ':!packages/db/node_modules'
  git -C "$T" -c user.name=db-verify-selftest -c user.email=selftest@invalid -c core.hooksPath=/dev/null \
    commit -qm "selftest: deployed on $1"
  git -C "$T" branch -f "$1" HEAD
}

# ---------------------------------------------------------------- controls

ALL="baseline edit_deployed drift rename functions_only function_missing divergent when not_null contract
  schema_mismatch deployed_on_dev untagged_production contract_unseeded contract_ack data_change new_constraint
  builtin_trigger disabled_fk seed_import_crash unreachable_db runner_mismatch ds_store"

# expect <control> — "<checks that must FAIL>|<checks that must PASS>|<exit code>"
expect() {
  case $1 in
    baseline) echo "|1 2 3 4 5 6 7 8|0" ;;
    edit_deployed) echo "2 5||1" ;;
    drift | rename) echo "1 7||1" ;;
    functions_only | function_missing | builtin_trigger) echo "6||1" ;;
    divergent | disabled_fk) echo "5||1" ;;
    when) echo "2 3||1" ;;
    not_null) echo "3||1" ;;
    contract) echo "3 8||1" ;;
    schema_mismatch) echo "7|1 2 3 4 5 6|1" ;;           # checks 1–6 cannot see it
    deployed_on_dev) echo "2||1" ;;
    untagged_production) echo "2 5||1" ;;
    contract_unseeded) echo "8|3|1" ;;                   # the seed replay in 3 cannot see it
    contract_ack) echo "|1 2 3 4 5 6 7 8|0" ;;
    data_change | new_constraint) echo "8||1" ;;
    seed_import_crash) echo "3 4|1 2|1" ;;               # history and ping must not be blamed
    unreachable_db) echo "|1 2|2" ;;
    runner_mismatch) echo "3||1" ;;
    ds_store) echo "|1 2 3 4 5 6 7 8|0" ;;
    *) return 1 ;;
  esac
}

# env for the db-verify run of a control, one NAME=value per line
env_of() {
  case $1 in
    deployed_on_dev) echo "DB_VERIFY_DEPLOYED_REFS=$HEAD_SHA nc-dev" ;;
    untagged_production) printf '%s\n' "DB_VERIFY_DEPLOYED_REFS=$HEAD_SHA nc-main" "DB_VERIFY_PRODUCTION_REF=nc-main" ;;
    unreachable_db) echo "TEST_DATABASE_URL=postgres://ong:ong@127.0.0.1:1/postgres" ;;
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
    builtin_trigger) # a trigger on a built-in function, created only by a migration
      custom_migration nc_trigger \
        'CREATE TRIGGER metal_skip_noop BEFORE UPDATE ON metal FOR EACH ROW EXECUTE FUNCTION suppress_redundant_updates_trigger();'
      changed "a trigger that functions.sql does not define"
      ;;
    divergent) # DDL that depends on existing rows: production and a fresh install end up different
      custom_migration nc_divergent 'DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM branch) THEN
    CREATE TABLE nc_diverge (id integer);
  END IF;
END $$;'
      changed "a migration that depends on existing rows"
      ;;
    disabled_fk) # foreign keys silently switched off where rows exist (the internal triggers)
      custom_migration nc_disabled_fk 'DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM metal) THEN
    ALTER TABLE buy_line DISABLE TRIGGER ALL;
  END IF;
END $$;'
      changed "disable FK enforcement on databases that have rows"
      ;;
    when) # generated on an older branch, merged later: the runner skips it on existing databases
      custom_migration nc_when 'CREATE TABLE nc_when (id integer);'
      node -e 'const fs = require("fs"); const f = process.argv[1]; const j = JSON.parse(fs.readFileSync(f, "utf8"));
        j.entries.at(-1).when = j.entries.at(-2).when - 1; fs.writeFileSync(f, JSON.stringify(j, null, 2))' \
        "$DB/migrations/meta/_journal.json"
      changed "a new migration older than the previous one"
      ;;
    not_null) # fine on an empty database, fails on production's rows
      perl -0pi -e 's/(pgTable\(\s*"branch",\s*\{\n)/$1    ncRequired: text("nc_required").notNull(),\n/' \
        "$DB/src/schema.ts"
      generate nc_not_null
      changed "NOT NULL column without default on a table that has rows"
      ;;
    contract) # drops a column the previous release still writes during the deploy
      perl -0pi -e 's/(pgTable\(\s*"metal",\s*\{[^}]*?)\n[ \t]*sortOrder: integer\("sort_order"\)[^\n]*/$1/' "$DB/src/schema.ts"
      generate nc_contract
      changed "drop a column the previous release still writes"
      ;;
    schema_mismatch) # a hand-written migration that disagrees with schema.ts: money becomes float
      custom_migration nc_money_float 'ALTER TABLE "buy_line" ALTER COLUMN "amount" TYPE double precision;'
      changed "a custom migration that contradicts schema.ts"
      ;;
    deployed_on_dev) # a migration already applied on the dev environment, then edited
      custom_migration nc_on_dev 'CREATE TABLE nc_on_dev (id integer);'
      deploy_as nc-dev
      printf '%s\n' 'CREATE TABLE nc_on_dev (id integer, extra text);' >"$DB/migrations/$(last_tag).sql"
      changed "edit a migration that dev already applied"
      ;;
    untagged_production) # an untagged commit on main deployed a migration; then it is edited
      custom_migration nc_on_main 'CREATE INDEX nc_on_main ON metal (name_th);'
      deploy_as nc-main
      printf '%s\n' 'CREATE INDEX nc_on_main ON metal (code);' >"$DB/migrations/$(last_tag).sql"
      changed "edit a migration that production runs but no tag contains"
      ;;
    contract_unseeded | contract_ack) # drops a column the previous release's API still reads
      perl -0pi -e 's/\n[ \t]*phone2: text\("phone2"\),//' "$DB/src/schema.ts"
      generate nc_drop_phone2
      if [ "$1" = contract_ack ]; then
        { echo "-- db-verify: allow contract the previous release no longer reads customer.phone2 (selftest)"; cat "$DB/migrations/$(last_tag).sql"; } \
          >"$SCRATCH/ack.sql" && mv "$SCRATCH/ack.sql" "$DB/migrations/$(last_tag).sql"
      fi
      changed "drop a column outside the seeded tables"
      ;;
    data_change) # a migration that rewrites tax documents
      custom_migration nc_rewrite 'UPDATE buy_receipt SET total_amount = total_amount;'
      changed "a migration that rewrites existing rows"
      ;;
    new_constraint) # a CHECK that judges rows already in production
      custom_migration nc_check 'ALTER TABLE "metal" ADD CONSTRAINT "nc_code_lower" CHECK ("metal"."code" = lower("metal"."code"));'
      changed "a new constraint on an existing column"
      ;;
    seed_import_crash) # the seed module throws when imported: only the steps that seed may fail
      printf '\n%s\n' 'export const NC_BROKEN = (undefined as unknown as { x: string }).x;' >>"$DB/src/seedData.ts"
      changed "a seed module that throws on import"
      ;;
    unreachable_db) ;;
    runner_mismatch) # Renovate bumps drizzle-orm in one importer only: production's runner differs
      mkdir -p "$T/apps/api/node_modules/drizzle-orm"
      printf '%s\n' '{ "name": "drizzle-orm", "version": "0.0.0-selftest" }' >"$T/apps/api/node_modules/drizzle-orm/package.json"
      [ -f "$T/apps/api/node_modules/drizzle-orm/package.json" ]
      ;;
    ds_store) # a git-ignored file in migrations/meta (Finder) must not change any verdict
      printf 'Bud1' >"$DB/migrations/meta/.DS_Store"
      [ -f "$DB/migrations/meta/.DS_Store" ] && [ -z "$(git -C "$T" status --porcelain -- packages/db/migrations)" ]
      ;;
  esac
}

SELECTED=${*:-$ALL}

# ---------------------------------------------------------------- run

printf '%-20s %-9s %-9s %-4s %-17s %s\n' control "must fail" "must pass" exit "got 1-8" result
bad=0
for name in $SELECTED; do
  spec=$(expect "$name") || {
    echo "unknown control: $name (have: $(printf '%s' "$ALL" | tr -s ' \n' ' '))" >&2
    exit 2
  }
  want_fail=${spec%%|*}
  rest=${spec#*|}
  want_pass=${rest%%|*}
  want_rc=${rest#*|}
  reset_tree
  log=$SCRATCH/$name.log
  if ! mutate "$name" >"$log" 2>&1; then
    printf '%-20s %-9s %-9s %-4s %-17s %s\n' "$name" "${want_fail:--}" "${want_pass:--}" "$want_rc" "-" "SETUP FAILED"
    sed 's/^/    /' "$log"
    bad=1
    continue
  fi
  rc=0
  envs=()
  while IFS= read -r line; do [ -z "$line" ] || envs+=("$line"); done < <(env_of "$name")
  env ${envs[@]+"${envs[@]}"} "$T/scripts/ci/db-verify.sh" >>"$log" 2>&1 || rc=$?
  got=""
  ok=1
  for n in 1 2 3 4 5 6 7 8; do
    s=$(awk -v n="$n" '$1 ~ /^(PASS|FAIL|SKIP|ERROR)$/ && $2 == n { print $1; exit }' "$log")
    got="$got ${s:0:1}"
    for f in $want_fail; do [ "$f" != "$n" ] || [ "$s" = FAIL ] || ok=0; done
    for p in $want_pass; do [ "$p" != "$n" ] || [ "$s" = PASS ] || ok=0; done
  done
  [ "$rc" -eq "$want_rc" ] || ok=0
  if [ "$ok" = 1 ]; then result=ok; else
    result=UNEXPECTED
    bad=1
  fi
  printf '%-20s %-9s %-9s %-4s %-17s %s\n' "$name" "${want_fail:--}" "${want_pass:--}" "$rc" "$got" "$result"
  if [ "$ok" != 1 ] || [ "${DB_VERIFY_SELFTEST_VERBOSE:-0}" = 1 ]; then
    awk '/^(PASS|FAIL|SKIP|ERROR) +[1-8] |^      / && shown++ < 80 { print "    " $0 }' "$log"
  fi
  [ "$ok" = 1 ] || tail -n 12 "$log" | sed 's/^/    | /'
done
exit "$bad"

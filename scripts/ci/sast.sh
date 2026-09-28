#!/usr/bin/env bash
# sast.sh — static application security testing (SAST) for ong-lom-thong with Semgrep CE
#
# Scans the TypeScript/JavaScript/HTML under apps/ and packages/ (what is left out, and why:
# .semgrepignore) with
#   1. community rules from github.com/semgrep/semgrep-rules at one pinned commit (RULES_SHA): every
#      security/ directory under javascript/ and typescript/, plus javascript/audit,
#      problem-based-packs/insecure-transport/js-node, html/security and generic/unicode/security — a
#      superset of the JS/TS/HTML rules in the registry packs p/javascript p/typescript p/react p/nodejs
#      p/owasp-top-ten p/default p/security-audit (compared 2026-09-28)
#   2. project rules in .semgrep/rules (SQL built from strings, public or pre-signed S3 objects, national
#      ID in logs, unescaped HTML), each self-tested against its fixture with `semgrep --test` first
# The rules are fetched once per commit into a local cache and verified against RULES_SHA; Semgrep then
# runs without network (--network none, --metrics=off), so one commit always gives one result. It reads a
# snapshot of exactly the files git would commit under those paths (tracked + untracked, not ignored), so
# a local .env or node_modules never reaches the container. In the snapshot, `node:` is stripped from import
# specifiers so upstream rules written for require('child_process') etc. also match ESM imports.
# Fails on ERROR findings (and HIGH/CRITICAL, should a rule ever use them); WARNING/INFO are listed only.
#
# Run:      make sast (= scripts/ci/sast.sh) — the same command locally and in CI
# Needs:    bash (3.2+), git, docker, jq, perl, tar · network access to github.com only while the rules cache is cold
# Exit:     0 no blocking finding · 1 blocking finding(s) or an invalid suppression · 2 tool or setup error
#           (any Semgrep error — rule parse error, timeout, unparsable file —, a failing rule test, or a
#           scan that read nothing: never counted as a pass)
# Reports:  $ONG_SEC_OUT (default $RUNNER_TEMP or $TMPDIR, then /ong-sec)/sast/semgrep.{json,sarif,log}
#           without source excerpts (Semgrep CE writes "requires login"; SARIF snippets are stripped)
# Suppress: one finding: a comment on its line or on the line above, with a reason and an expiry at most
#           MAX_SUPPRESS_DAYS ahead — enforced here, and a bare `nosemgrep` (no rule id) fails the scan:
#             // nosemgrep: <rule-id> -- <why this is safe> (expires YYYY-MM-DD)
#           whole paths: .semgrepignore, each entry under a comment that gives its reason
# Update:   image: docker buildx imagetools inspect semgrep/semgrep:<tag> → use the index digest
#           rules: gh api repos/semgrep/semgrep-rules/commits/develop --jq .sha → RULES_SHA, then run this
#           script and triage what the new rules report, in the same PR
# Cache:    ${ONG_SEC_CACHE:-${XDG_CACHE_HOME:-~/.cache}/ong-sec}/semgrep-rules/<sha> — safe to delete
set -euo pipefail

# renovate: datasource=docker depName=semgrep/semgrep
readonly SEMGREP_IMAGE="semgrep/semgrep:1.178.0@sha256:32e459968daabe7ab86968184a29109b9564aa00392401156f9788452b42786b"
# develop @ 2026-09-22 (merge of PR #4052) · licence: Semgrep Rules License v1.0 (internal use; the rules
# are fetched, never copied into this repo)
# renovate: datasource=git-refs depName=https://github.com/semgrep/semgrep-rules currentValue=develop
readonly RULES_SHA="a84ff9cc2453ca91d581380de4b8b3f272f6f4be"
readonly RULES_URL="https://github.com/semgrep/semgrep-rules.git"
readonly MAX_SUPPRESS_DAYS=90 # same horizon as osv-scanner.toml (sca.sh) and .github/zizmor.yml (ci-lint.sh)
# The image also ships semgrep-core-proprietary (the closed-source Pro engine), and pysemgrep prefers it
# for its RPC calls even in an OSS scan. Masking it with /dev/null keeps every executed binary the
# LGPL-2.1 semgrep-core, i.e. Semgrep Community Edition only. Moved in a new image? Then the scan log
# shows "Executed as: …proprietary" (checked below) and this path needs updating.
readonly PRO_CORE="/usr/lib/python3.12/site-packages/semgrep/bin/semgrep-core-proprietary"

# semgrep-rules directories to fetch (sparse, cone mode). Only the rule YAML is loaded as config: the
# fixtures next to each rule (*.js, *.ts, *.test.yaml …) are never read as rules.
readonly RULES_FETCH=(javascript typescript problem-based-packs/insecure-transport/js-node html/security
  generic/unicode/security)
# Loaded: every security/ directory under javascript/ and typescript/ (found at run time), plus these
readonly RULES_EXTRA=(javascript/audit problem-based-packs/insecure-transport/js-node html/security
  generic/unicode/security)
readonly TARGETS=(apps packages)
# Each of these must contribute scanned files: a scan that reads nothing from one of them is broken
readonly CANARIES=(apps/api/src apps/web/src packages/core/src packages/db/src)

SECONDS=0
die() {
  echo "sast: $*" >&2
  exit 2
}
in_gha() { [ "${GITHUB_ACTIONS:-}" = true ]; }

command -v git >/dev/null || die "git not found"
command -v docker >/dev/null || die "docker not found"
command -v jq >/dev/null || die "jq not found"
command -v perl >/dev/null || die "perl not found"

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
root=$(git -C "$here" rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repository"
root=$(cd "$root" && pwd -P)
cd "$root"
[ -f .semgrepignore ] || die ".semgrepignore not found in $root"

out="${ONG_SEC_OUT:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ong-sec}/sast"
probe=$out # refuse before mkdir, so not even an empty directory lands in the repo
while [ ! -d "$probe" ]; do probe=$(dirname "$probe"); done
case "$(cd "$probe" && pwd -P)/" in "$root"/*) die "report dir must be outside the repo: $out" ;; esac
mkdir -p "$out"
out=$(cd "$out" && pwd -P)
case "$out/" in "$root"/*) die "report dir must be outside the repo: $out" ;; esac
rm -f "$out/semgrep.json" "$out/semgrep.sarif" "$out/semgrep.log" "$out/rule-tests.log"
tmp=$(mktemp -d "$out/tmp.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

cache="${ONG_SEC_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/ong-sec}/semgrep-rules"
mkdir -p "$cache"
cache=$(cd "$cache" && pwd -P)
case "$cache/" in "$root"/*) die "rules cache must be outside the repo: $cache" ;; esac
rules="$cache/$RULES_SHA"

# --- 1. community rules: pinned commit, verified, cached ------------------------------------------------
# verified = HEAD is RULES_SHA, the sparse set is RULES_FETCH, and nothing in the checkout is modified,
# added or deleted (git status compares every file with the blob ids recorded in the pinned commit)
verify_rules() { # <dir>
  local sparse status
  [ -d "$1/.git" ] || return 1
  [ "$(git -C "$1" rev-parse -q --verify 'HEAD^{commit}' 2>/dev/null)" = "$RULES_SHA" ] || return 1
  sparse=$(git -C "$1" sparse-checkout list 2>/dev/null | LC_ALL=C sort) || return 1
  [ "$sparse" = "$(printf '%s\n' "${RULES_FETCH[@]}" | LC_ALL=C sort)" ] || return 1
  status=$(git -C "$1" status --porcelain --untracked-files=all --ignored 2>/dev/null) || return 1
  [ -z "$status" ]
}

echo "==> semgrep-rules @ ${RULES_SHA:0:12}"
if [ -d "$rules" ] && verify_rules "$rules"; then
  echo "    cache hit: $rules (${SECONDS}s)"
else
  if [ -e "$rules" ]; then
    echo "    cached copy does not match the pinned commit — fetching again"
    rm -rf "${cache:?}/$RULES_SHA"
  fi
  fetch=$(mktemp -d "$cache/.fetch.XXXXXX")
  trap 'rm -rf "$tmp" "$fetch"' EXIT
  (
    export GIT_TERMINAL_PROMPT=0
    cd "$fetch"
    git init -q
    git remote add origin "$RULES_URL"
    git sparse-checkout set --cone "${RULES_FETCH[@]}"
    # shallow + blobless: one commit, and only the blobs under the sparse directories are downloaded
    git -c protocol.version=2 fetch -q --depth 1 --filter=blob:none --no-tags origin "$RULES_SHA"
    git -c advice.detachedHead=false checkout -q --detach FETCH_HEAD
  ) || die "could not fetch $RULES_URL at $RULES_SHA (network?)"
  verify_rules "$fetch" || die "fetched semgrep-rules do not verify against $RULES_SHA"
  # another run may have filled the cache meanwhile — keep the first copy, both are the same commit
  if [ -e "$rules" ]; then rm -rf "$fetch"; else mv "$fetch" "$rules"; fi
  trap 'rm -rf "$tmp"' EXIT
  verify_rules "$rules" || die "rules cache $rules does not verify — delete it and run again"
  echo "    fetched: $rules (${SECONDS}s)"
fi

configs=()
while IFS= read -r d; do
  configs+=(--config "/semgrep-rules/$d")
done < <(
  cd "$rules" && {
    find javascript typescript -type d -name security -prune -print
    printf '%s\n' "${RULES_EXTRA[@]}"
  } | LC_ALL=C sort -u
)
for d in "${RULES_EXTRA[@]}"; do [ -d "$rules/$d" ] || die "rules directory missing at $RULES_SHA: $d"; done
community_dirs=$((${#configs[@]} / 2))
project_rules=0
if compgen -G '.semgrep/rules/*.yml' >/dev/null; then
  configs+=(--config /src/.semgrep/rules)
  project_rules=1
fi

# --- snapshot: the files git would commit under the targets, plus the Semgrep config -----------------------
# (scanning the checkout itself also works, but Semgrep's target discovery then walks pnpm's node_modules
# and takes minutes instead of seconds; and the container would see local files such as .env)
src="$tmp/src"
mkdir -p "$src"
while IFS= read -r -d '' f; do
  # regular files only — deleted-but-tracked paths and symlinks are skipped
  if [ -f "$f" ] && [ ! -L "$f" ]; then printf '%s\0' "$f"; fi
done < <(git ls-files -z --cached --others --exclude-standard -- "${TARGETS[@]}" .semgrepignore .semgrep) \
  >"$tmp/files"
tar --null -T "$tmp/files" -cf - | tar -xf - -C "$src"
# Upstream rules name Node built-ins without the node: prefix (require('child_process'), from 'fs', 'vm',
# 'path' — 8 rule files at RULES_SHA, 5 of them ERROR: command and code injection), so they never match
# this codebase's `import … from "node:…"`. Strip the prefix from import/require specifiers in the
# snapshot only (same line, so reported line numbers stay exact); the checkout itself is never touched.
for d in "${TARGETS[@]}"; do
  [ -d "$src/$d" ] || continue
  find "$src/$d" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.mts' -o -name '*.cts' -o -name '*.js' \
    -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' \) -exec perl -pi -e \
    's/(\b(?:from|import|require)\s*\(?\s*["\x27`])node:/$1/g' {} +
done

# --- container: offline, unprivileged, read-only root; snapshot and rules mounted read-only ----------------
docker_run=(docker run --rm --network none --user "$(id -u):$(id -g)" --cap-drop ALL
  --security-opt no-new-privileges --read-only --tmpfs /tmp -e HOME=/tmp
  -e SEMGREP_SEND_METRICS=off -e SEMGREP_ENABLE_VERSION_CHECK=0
  -v "$src:/src:ro" -v "$rules:/semgrep-rules:ro" -v "$out:/out" -v "/dev/null:$PRO_CORE:ro" -w /src)
semgrep_flags=(--metrics=off --disable-version-check)

# --- 2. engine check, then the project rules' self-test against their fixtures ---------------------------
# pro_path() is Semgrep's own lookup of the proprietary engine: it must find nothing (see PRO_CORE)
engine_check='import sys; from semgrep.semgrep_core import SemgrepCore; sys.exit(97 if SemgrepCore.pro_path() else 0)'
tests=""
[ "$project_rules" = 0 ] || tests=/src/.semgrep/rules
echo "==> engine check${tests:+ + semgrep --test .semgrep/rules}"
rc=0
# shellcheck disable=SC2016 # $1/$2 belong to the sh -c script inside the container
"${docker_run[@]}" --name "ong-sec-sast-test-$$" "$SEMGREP_IMAGE" sh -c '
  python3 -c "$1" || exit 97
  [ -z "$2" ] || exec semgrep --test --metrics=off --disable-version-check "$2"' sh "$engine_check" "$tests" \
  >"$out/rule-tests.log" 2>&1 || rc=$?
case "$rc" in
  0) ;;
  97) die "the image's proprietary Semgrep engine is still reachable — update PRO_CORE for this image" ;;
  *)
    cat "$out/rule-tests.log" >&2
    die "project rule tests failed (exit $rc) — fix the rule or its fixture in .semgrep/rules"
    ;;
esac
if [ -n "$tests" ]; then
  grep -q 'All tests passed' "$out/rule-tests.log" || die "project rule tests did not pass — see $out/rule-tests.log"
  echo "    $(grep -E 'tests? passed' "$out/rule-tests.log" | tail -n 1) (${SECONDS}s)"
fi

# --- 3. scan --------------------------------------------------------------------------------------------
# The scanning root is the snapshot itself ("."): it holds only the targets, and Semgrep reads the
# .semgrepignore of its project root — with "apps packages" as roots it would not (no git in the snapshot).
# --x-rule-validation none: skip pysemgrep's per-file pre-validation (one semgrep-core process per rule
# file, ~200 here: most of the run time). semgrep-core still parses every rule for the scan, and a broken
# rule then fails the whole scan (exit 7, no results) — checked below, so nothing passes silently.
echo "==> semgrep scan ${TARGETS[*]} ($community_dirs community rule directories + project rules)"
rc=0
"${docker_run[@]}" --name "ong-sec-sast-scan-$$" "$SEMGREP_IMAGE" \
  semgrep scan "${semgrep_flags[@]}" --oss-only --x-rule-validation none --timeout 30 "${configs[@]}" \
  --json --output /out/semgrep.json --sarif-output /out/semgrep.sarif . \
  >/dev/null 2>"$out/semgrep.log" || rc=$?
json="$out/semgrep.json"
sarif="$out/semgrep.sarif"
if ! jq -e '.results and .errors and .paths' "$json" >/dev/null 2>&1; then
  tail -n 40 "$out/semgrep.log" >&2
  die "semgrep produced no usable JSON report (exit $rc) — see $out/semgrep.log"
fi
# SARIF carries the matched source line (JSON does not): drop it so reports never hold code or secrets
if [ -s "$sarif" ]; then
  jq 'walk(if type == "object" then del(.snippet, .contextRegion) else . end)' "$sarif" >"$sarif.tmp"
  mv "$sarif.tmp" "$sarif"
fi

# --- 4. was it a complete scan? any Semgrep error, or no rules / no files, is a tool failure -------------
errors=$(jq -r '.errors[] | [.level // "?", .type // "?", (.path // .spans[0].file // "-"), (.rule_id // "-"),
  ((.message // "") | gsub("\\s+"; " ") | .[0:300])] | @tsv' "$json")
if [ -n "$errors" ]; then
  echo "Semgrep reported errors — the scan is incomplete:" >&2
  printf '%s\n' "$errors" | while IFS=$'\t' read -r level type path rule msg; do
    echo "  [$level] $type  $path  $rule" >&2
    echo "      $msg" >&2
  done
fi
[ "$rc" = 0 ] || die "semgrep exited with $rc — see $out/semgrep.log"
[ -z "$errors" ] || die "semgrep reported $(printf '%s\n' "$errors" | wc -l | tr -d ' ') error(s) (listed above)"
rules_run=$(jq '[.runs[].tool.driver.rules[]] | length' "$sarif" 2>/dev/null || echo 0)
project_run=$(jq '[.runs[].tool.driver.rules[].id | select(startswith("semgrep.rules."))] | length' "$sarif" 2>/dev/null || echo 0)
[ "$rules_run" -gt 0 ] || die "no rules were run"
[ "$project_rules" = 0 ] || [ "$project_run" -gt 0 ] || die "the project rules in .semgrep/rules were not run"
scanned=$(jq '.paths.scanned | length' "$json")
[ "$scanned" -gt 0 ] || die "no files were scanned — check .semgrepignore and the targets (${TARGETS[*]})"
for c in "${CANARIES[@]}"; do
  jq -e --arg c "$c/" 'any(.paths.scanned[]; startswith($c))' "$json" >/dev/null ||
    die "nothing under $c was scanned — check .semgrepignore"
done
echo "    $rules_run rules ($project_run project) · $scanned files · no errors (${SECONDS}s)"

# --- 5. findings ----------------------------------------------------------------------------------------
# severity rank: blocking first (CRITICAL/HIGH/ERROR), then WARNING (MEDIUM), then INFO (LOW)
findings=$(jq -r '
  def rank: {"CRITICAL": 0, "HIGH": 1, "ERROR": 2, "MEDIUM": 3, "WARNING": 4, "LOW": 5, "INFO": 6}[.] // 7;
  .results | sort_by((.extra.severity | rank), .path, .start.line, .check_id)[]
  | [.extra.severity, .check_id, .path, (.start.line | tostring),
     (.extra.metadata.confidence // "-"),
     (.extra.message | gsub("\\s+"; " ") | if length > 300 then .[0:297] + "..." else . end)] | @tsv' "$json")
count() { jq --arg s "$1" '[.results[] | select(.extra.severity as $x | $s | split(",") | index($x))] | length' "$json"; }
blocking=$(count ERROR,HIGH,CRITICAL)
warnings=$(count WARNING,MEDIUM)
infos=$(count INFO,LOW,EXPERIMENT,INVENTORY)
gha_msg() { # escape for a workflow command message
  local s=${1//%/%25}
  s=${s//$'\r'/%0D}
  printf '%s' "${s//$'\n'/%0A}"
}
if [ -n "$findings" ]; then
  echo
  echo "Findings — severity · rule · location (confidence) — message:"
  printf '%s\n' "$findings" | while IFS=$'\t' read -r sev rule path line conf msg; do
    printf '  %-7s  %s  %s:%s (%s)\n           %s\n' "$sev" "$rule" "$path" "$line" "$conf" "$msg"
    case "$sev" in
      ERROR | HIGH | CRITICAL) in_gha && echo "::error file=$path,line=$line,title=semgrep $rule::$(gha_msg "$msg")" ;;
    esac
  done
fi

# --- 6. suppressions: every nosemgrep names its rule(s), gives a reason and an expiry --------------------
today=$(jq -rn 'now | strftime("%Y-%m-%d")')
horizon=$(jq -rn --argjson d "$MAX_SUPPRESS_DAYS" 'now + $d * 86400 | strftime("%Y-%m-%d")')
# (read from the snapshot, i.e. exactly the bytes Semgrep scanned)
marks=$(jq -j '.paths.scanned[] | . + "\u0000"' "$json" | (cd "$src" && xargs -0 grep -nHIE 'nosem' --) || true)
suppressions=""
bad_suppressions=0
if [ -n "$marks" ]; then
  suppressions=$(printf '%s\n' "$marks" | jq -rR --arg today "$today" --arg horizon "$horizon" \
    --arg days "$MAX_SUPPRESS_DAYS" '
    ([capture("^(?<file>[^:]+):(?<line>[0-9]+):(?<text>.*)$")] | .[0]) as $m
    | select($m != null)
    | ([$m.text | capture("nosem(grep)?:\\s*(?<ids>[\\w.:/-]+(\\s*,\\s*[\\w.:/-]+)*)\\s+--\\s+(?<reason>.*\\S)\\s+\\(expires (?<exp>\\d{4}-\\d{2}-\\d{2})\\)")] | .[0]) as $s
    | if $s == null then [$m.file, $m.line, "invalid", "-", "-", "expected: nosemgrep: <rule-id> -- <reason> (expires YYYY-MM-DD)"]
      elif ($s.reason | length) < 10 then [$m.file, $m.line, "invalid", $s.ids, $s.exp, "reason too short"]
      elif $s.exp < $today then [$m.file, $m.line, "invalid", $s.ids, $s.exp, "expired — triage it again"]
      elif $s.exp > $horizon then [$m.file, $m.line, "invalid", $s.ids, $s.exp, "expires more than \($days) days ahead"]
      else [$m.file, $m.line, "ok", $s.ids, $s.exp, $s.reason] end
    | @tsv') || die "could not parse the nosemgrep comments"
fi
if [ -n "$suppressions" ]; then
  echo
  echo "Suppressions (nosemgrep) — location · rule(s) · expires — reason:"
  while IFS=$'\t' read -r file line state ids exp reason; do
    if [ "$state" = ok ]; then
      echo "  ok       $file:$line  $ids  (expires $exp) — $reason"
    else
      bad_suppressions=$((bad_suppressions + 1))
      echo "  INVALID  $file:$line  $ids  (expires $exp) — $reason"
      in_gha && echo "::error file=$file,line=$line,title=invalid nosemgrep::$(gha_msg "$reason")"
    fi
  done <<<"$suppressions"
fi

# --- 7. summary -----------------------------------------------------------------------------------------
active=$(printf '%s\n' "$suppressions" | awk -F'\t' '$3 == "ok"' | grep -c . || true)
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    version=${SEMGREP_IMAGE#*:}
    echo "### SAST (Semgrep CE ${version%%@*} · semgrep-rules ${RULES_SHA:0:12})"
    echo
    echo "| check | result |"
    echo "| --- | --- |"
    echo "| rules | $rules_run ($project_run project, self-tested) |"
    echo "| files scanned | $scanned (${TARGETS[*]}; exclusions in \`.semgrepignore\`) |"
    echo "| findings | $blocking blocking (ERROR) · $warnings warning · $infos info |"
    echo "| suppressions | $active active · $bad_suppressions invalid |"
    if [ -n "$findings" ]; then
      echo
      echo "| severity | rule | location | message |"
      echo "| --- | --- | --- | --- |"
      printf '%s\n' "$findings" | head -n 100 | while IFS=$'\t' read -r sev rule path line _ msg; do
        echo "| $sev | \`$rule\` | \`$path:$line\` | ${msg//|/\\|} |"
      done
    fi
  } >>"$GITHUB_STEP_SUMMARY"
fi

summary="$rules_run rules · $scanned files · $blocking blocking · $warnings warning · $infos info · $active suppression(s)"
if [ "$blocking" = 0 ] && [ "$bad_suppressions" = 0 ]; then
  echo "sast: clean — $summary · ${SECONDS}s — reports in $out"
else
  echo "sast: FAILED — $summary · $bad_suppressions invalid suppression(s) · ${SECONDS}s — reports in $out" >&2
  exit 1
fi

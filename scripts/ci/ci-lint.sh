#!/usr/bin/env bash
# ci-lint.sh — lint the CI itself: GitHub Actions workflows and the shell scripts they run
#
# Runs all three checks, reports every finding, and fails if any check fails:
#   1. actionlint over .github/workflows — syntax, expressions, contexts, job graph, action inputs,
#      plus shellcheck and pyflakes on every inline `run:` script
#   2. zizmor over the repo root — workflows, composite actions wherever they live, dependabot.yml,
#      .gitignore honoured — with .github/zizmor.yml, --strict-collection and the regular persona.
#      (The root rather than .github: --format github makes annotation paths relative to the input.)
#      Online audits (impostor-commit, known-vulnerable-actions, ref-confusion, ref-version-mismatch,
#      stale-action-refs) need a GitHub token — see Token below. .github/zizmor.yml is checked first:
#      no `disable:`, unpinned-uses stays hash-pin, and every ignore names a line and sits under a
#      "# <reason> · until YYYY-MM-DD" comment at most MAX_IGNORE_DAYS ahead (zizmor has no expiry field)
#   3. shellcheck over scripts/ci/**/*.sh at every severity — logic longer than ~5 lines lives in
#      scripts/ci, where actionlint's run: check never looks. Suppress inline only, with a reason:
#      `# shellcheck disable=SCnnnn # why`
#
# Run:      make ci-lint (= scripts/ci/ci-lint.sh) — the same command locally and in CI, from any cwd
# Needs:    bash (3.2+), git, docker · network only to pull the pinned images and for zizmor's online audits
# Token:    ZIZMOR_GITHUB_TOKEN, else GH_TOKEN, else GITHUB_TOKEN, else (outside CI) `gh auth token`.
#           CI passes GH_TOKEN: ${{ github.token }} (contents: read is enough). The value is never printed or
#           put on a command line; only the zizmor container receives it (docker -e GH_TOKEN, by name).
#           Locally a fine-grained read-only token in ZIZMOR_GITHUB_TOKEN beats gh's broad OAuth token.
#           No token, or ONG_SEC_OFFLINE=1 → zizmor runs offline (no network at all) and says so loudly.
# Options:  ONG_SEC_ZIZMOR_PERSONA=pedantic|auditor — manual review only; the gate is the regular persona
# Exit:     0 clean · 1 finding(s) · 2 tool or setup error (a check that did not run never passes)
# Reports:  $ONG_SEC_OUT (default $RUNNER_TEMP or $TMPDIR, then /ong-sec)/ci-lint/{actionlint,zizmor,shellcheck}.log
#           + summary.md; nothing is written inside the repo (mounted read-only into every container)
# Update:   docker buildx imagetools inspect <image>:<tag> → use the index digest (amd64 + arm64). The
#           actionlint image also supplies shellcheck and pyflakes: re-check their versions when it moves.
set -euo pipefail

# renovate: datasource=docker depName=rhysd/actionlint
readonly ACTIONLINT_IMAGE="rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667"
# renovate: datasource=docker depName=ghcr.io/zizmorcore/zizmor
readonly ZIZMOR_IMAGE="ghcr.io/zizmorcore/zizmor:1.30.1@sha256:a2eb396d886c053073405c7a980f2139ba2248ec172243cfa3841e57196e8101"
readonly ZIZMOR_CONFIG=.github/zizmor.yml
readonly MAX_IGNORE_DAYS=90
# GitHub annotations for actionlint: one ::error per finding, % CR LF escaped as workflow commands require
# (actionlint unescapes \\ and \n in the template first, so "\\n" reaches Go's template parser as "\n")
# shellcheck disable=SC2016 # a Go template for actionlint: $e must reach it unexpanded
readonly ACTIONLINT_GHA_FORMAT='{{range $e := .}}::error file={{$e.Filepath}},line={{$e.Line}},col={{$e.Column}},endColumn={{$e.EndColumn}},title=actionlint {{$e.Kind}}::{{replace $e.Message "%" "%25" "\\r" "%0D" "\\n" "%0A"}}%0A%0A{{replace $e.Snippet "%" "%25" "\\r" "%0D" "\\n" "%0A"}}\n{{end}}'

SECONDS=0
umask 077 # reports quote workflow source: keep them private to the current user
die() {
  echo "ci-lint: $*" >&2
  exit 2
}
in_gha() { [ "${GITHUB_ACTIONS:-}" = true ]; }
warn() {
  if in_gha; then echo "::warning title=ci-lint::$*"; else echo "WARNING: $*" >&2; fi
}
version_of() { # <image ref> → tag
  local v=${1#*:}
  echo "${v%%@*}"
}

command -v git >/dev/null || die "git not found"
command -v docker >/dev/null || die "docker not found"
docker version --format '{{.Server.Version}}' >/dev/null 2>&1 || die "docker daemon not reachable — start Docker"

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
root=$(git -C "$here" rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repository"
root=$(cd "$root" && pwd -P)
cd "$root"
[ -d .github/workflows ] || die "no .github/workflows in $root"
[ -f "$ZIZMOR_CONFIG" ] || die "$ZIZMOR_CONFIG not found — it holds the unpinned-uses policy and every suppression"

persona=${ONG_SEC_ZIZMOR_PERSONA:-regular}
case "$persona" in
  regular | pedantic | auditor) ;;
  *) die "ONG_SEC_ZIZMOR_PERSONA must be regular, pedantic or auditor" ;;
esac

out="${ONG_SEC_OUT:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ong-sec}/ci-lint"
probe=$out # refuse before mkdir, so not even an empty directory lands in the repo
while [ ! -d "$probe" ]; do probe=$(dirname "$probe"); done
case "$(cd "$probe" && pwd -P)/" in "$root"/*) die "report dir must be outside the repo: $out" ;; esac
mkdir -p "$out"
out=$(cd "$out" && pwd -P)
case "$out/" in "$root"/*) die "report dir must be outside the repo: $out" ;; esac
rm -f "$out/actionlint.log" "$out/zizmor.log" "$out/shellcheck.log" "$out/summary.md"

for image in "$ACTIONLINT_IMAGE" "$ZIZMOR_IMAGE"; do
  docker image inspect "$image" >/dev/null 2>&1 || docker pull -q "$image" >/dev/null || die "cannot pull $image"
done

# every tool: unprivileged, no capabilities, no new privileges, read-only root filesystem, tini as PID 1
# (Ctrl-C works), bounded pids/memory, the repo mounted read-only at the same absolute path
docker_run=(docker run --rm --init --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges
  --read-only --tmpfs /tmp --pids-limit 256 --memory 1g -v "$root:$root:ro" -w "$root")

# defence in depth for the one secret this script handles: GitHub token shapes never reach a log
redact() { sed -E 's/(gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}/\1[REDACTED]/g'; }

run() { # <log> <filter> <command…> — stdout+stderr → filter → redact → terminal + log; returns the command's exit
  local log=$1 filter=$2 rc
  shift 2
  set +e
  "$@" 2>&1 | "$filter" | redact | tee "$log"
  rc=${PIPESTATUS[0]}
  set -e
  return "$rc"
}

# gcc-format lines from shellcheck → GitHub annotations; every severity fails the gate, so each is an error
# shellcheck disable=SC2329 # called through run()'s <filter> argument
shellcheck_annotations() {
  sed -E -e 's/%/%25/g' \
    -e 's/^([^:]+):([0-9]+):([0-9]+): (error|warning|note): (.*)$/::error file=\1,line=\2,col=\3,title=shellcheck \4::\5/'
}

overall=0 rows=""
record() { # <check> <pass|findings|error|skipped> <seconds> <scope>
  rows="$rows| $1 | $2 | $3s | $4 |"$'\n'
  case "$2" in
    findings) [ "$overall" = 2 ] || overall=1 ;;
    error) overall=2 ;;
  esac
  echo "    → $2 in ${3}s"
}
status_of() { # <tool> <exit code> → pass|findings|error
  case "$1:$2" in
    *:0) echo pass ;;
    actionlint:1 | shellcheck:1 | zizmor:1[1-4]) echo findings ;;
    *) echo error ;;
  esac
}

# --- 1. actionlint ------------------------------------------------------------------------------------
echo "==> actionlint $(version_of "$ACTIONLINT_IMAGE") over .github/workflows (+ shellcheck, pyflakes on run: scripts)"
t=$SECONDS rc=0
fmt=()
if in_gha; then fmt=(-format "$ACTIONLINT_GHA_FORMAT"); fi
run "$out/actionlint.log" cat "${docker_run[@]}" --name "ong-sec-actionlint-$$" --network none \
  "$ACTIONLINT_IMAGE" ${fmt[@]+"${fmt[@]}"} || rc=$?
status=$(status_of actionlint "$rc")
[ "$status" != error ] || echo "actionlint exited $rc (2 = bad option · 3 = fatal error · 125+ = docker)" >&2
record "actionlint $(version_of "$ACTIONLINT_IMAGE")" "$status" $((SECONDS - t)) ".github/workflows"

# --- 2. zizmor ----------------------------------------------------------------------------------------
echo "==> $ZIZMOR_CONFIG policy (no disable · hash-pin only · ignores need line, reason, expiry)"
t=$SECONDS
today=$(date -u +%Y-%m-%d)
horizon=$(date -u -v+"${MAX_IGNORE_DAYS}"d +%Y-%m-%d 2>/dev/null || date -u -d "+$MAX_IGNORE_DAYS days" +%Y-%m-%d)
policy_rc=0
# A comment block applies to the ignore entries directly below it; a blank line or any other key ends it.
awk -v today="$today" -v horizon="$horizon" -v days="$MAX_IGNORE_DAYS" -v quotes="\"'" '
  function indent(s) { match(s, /^ */); return RLENGTH }
  function problem(msg) { printf "%s:%d: %s\n", FILENAME, FNR, msg; bad = 1 }
  BEGIN { loose = ":[[:space:]]*[" quotes "]?(ref-pin|any)[" quotes "]?[[:space:]]*(#.*)?$" }
  /^[[:space:]]*#/ { note = (note == "" || after_item) ? $0 : note " " $0; after_item = 0; next }
  /^[[:space:]]*$/ { note = ""; after_item = 0; next }
  /^[[:space:]]*disable[[:space:]]*:/ { problem("`disable:` hides the whole audit — ignore the exact finding") }
  pin && indent($0) <= pin_indent { pin = 0 }
  /^[[:space:]]*unpinned-uses[[:space:]]*:/ { pin = 1; pin_indent = indent($0) }
  pin && $0 ~ loose { problem("unpinned-uses must stay hash-pin for every pattern (repo rule: actions pinned by SHA)") }
  list && indent($0) <= list_indent && $0 !~ /^[[:space:]]*-/ { list = 0 }
  /^[[:space:]]*ignore[[:space:]]*:/ {
    rest = $0; sub(/^[^:]*:[[:space:]]*/, "", rest); sub(/[[:space:]]*#.*$/, "", rest)
    if (rest != "") problem("write ignores as a block list, one entry per line, under their reason")
    list = 1; list_indent = indent($0); note = ""; after_item = 0; next
  }
  list && /^[[:space:]]*-/ {
    item = $0; sub(/^[[:space:]]*-[[:space:]]*/, "", item); sub(/[[:space:]]+#.*$/, "", item)
    gsub("[" quotes "]", "", item); after_item = 1
    if (item !~ /^[^:\/]+\.ya?ml:[0-9]+(:[0-9]+)?$/)
      problem("ignore must name a line, <workflow>.yml:<line>[:<column>] — got \"" item "\"")
    if (note == "") { problem("ignore " item ": no \"# <reason> · until YYYY-MM-DD\" right above it"); next }
    if (!match(note, /until 20[0-9][0-9]-[01][0-9]-[0-3][0-9]/)) {
      problem("ignore " item ": its comment has no \"until YYYY-MM-DD\""); next
    }
    until = substr(note, RSTART + 6, 10)
    reason = note; gsub(/until 20[0-9][0-9]-[01][0-9]-[0-3][0-9]|[#·[:space:][:punct:]]/, "", reason)
    if (length(reason) < 10) problem("ignore " item ": its comment needs a reason, not just a date")
    if (until < today) problem("ignore " item " expired on " until " — triage the finding again")
    else if (until > horizon) problem("ignore " item " runs until " until ", more than " days " days ahead")
    next
  }
  { note = ""; after_item = 0 }
  END { exit bad }
' "$ZIZMOR_CONFIG" || policy_rc=$?
case "$policy_rc" in
  0) status=pass ;;
  1) status=findings ;;
  *) status=error ;;
esac
record "$ZIZMOR_CONFIG policy" "$status" $((SECONDS - t)) "no disable · hash-pin · ignore = file:line + reason + expiry ≤ ${MAX_IGNORE_DAYS}d"

echo "==> zizmor $(version_of "$ZIZMOR_IMAGE") over the repo ($persona persona, --strict-collection)"
t=$SECONDS rc=0
zz=(--config "$ZIZMOR_CONFIG" --persona "$persona" --strict-collection --no-progress --color never
  --render-links never --cache-dir /tmp/zizmor-cache)
if in_gha; then zz+=(--format github); else zz+=(--format plain); fi
token="" from=""
if [ "${ONG_SEC_OFFLINE:-}" = 1 ]; then
  from="ONG_SEC_OFFLINE=1"
elif [ -n "${ZIZMOR_GITHUB_TOKEN:-}" ]; then
  token=$ZIZMOR_GITHUB_TOKEN from=ZIZMOR_GITHUB_TOKEN
elif [ -n "${GH_TOKEN:-}" ]; then
  token=$GH_TOKEN from=GH_TOKEN
elif [ -n "${GITHUB_TOKEN:-}" ]; then
  token=$GITHUB_TOKEN from=GITHUB_TOKEN
elif ! in_gha && command -v gh >/dev/null && token=$(gh auth token 2>/dev/null) && [ -n "$token" ]; then
  from="gh auth token"
fi
if [ -n "$token" ]; then
  mode="online · token from $from"
  export GH_TOKEN="$token" # for the docker CLI only: the container receives it by name, never via argv
  zz_docker=(-e GH_TOKEN)
else
  mode="OFFLINE · ${from:-no token}"
  zz+=(--offline)
  zz_docker=(--network none)
  warn "zizmor runs OFFLINE (${from:-no GitHub token}): impostor-commit, known-vulnerable-actions, ref-confusion," \
    "ref-version-mismatch and stale-action-refs are skipped — set GH_TOKEN or run gh auth login"
fi
echo "    mode: $mode"
zizmor_run() {
  run "$out/zizmor.log" cat "${docker_run[@]}" --name "ong-sec-zizmor-$$" "${zz_docker[@]}" -e HOME=/tmp \
    "$ZIZMOR_IMAGE" "${zz[@]}" .
}
zizmor_run || rc=$?
# exit 1 = an audit could not complete. Online that is usually a transient api.github.com failure, which
# must not turn ring 0 red on its own: retry once with the same audits, then report whatever remains.
if [ "$rc" = 1 ] && [ -n "$token" ]; then
  echo "    zizmor could not complete an audit — retrying once (online audits call api.github.com)" >&2
  rc=0
  zizmor_run || rc=$?
fi
unset GH_TOKEN token
status=$(status_of zizmor "$rc")
if [ "$status" = error ]; then
  echo "zizmor exited $rc (1 = audit error: invalid workflow under --strict-collection, bad token or no network —" \
    "ONG_SEC_OFFLINE=1 rules the last two out · 2 = bad option · 3 = nothing collected · 125+ = docker)" >&2
fi
record "zizmor $(version_of "$ZIZMOR_IMAGE")" "$status" $((SECONDS - t)) "repo root · $persona persona · $mode"

# --- 3. shellcheck ------------------------------------------------------------------------------------
echo "==> shellcheck over scripts/ci (every severity)"
t=$SECONDS rc=0
files=()
if [ -d scripts/ci ]; then
  while IFS= read -r f; do files+=("$f"); done < <(find scripts/ci -type f -name '*.sh' | LC_ALL=C sort)
fi
if [ "${#files[@]}" = 0 ]; then
  echo "    no scripts/ci/*.sh — skipped"
  record shellcheck skipped 0 "no scripts/ci/*.sh"
else
  # gcc format, not tty: the image's static shellcheck writes ASCII only and aborts (exit 2) when tty output
  # would echo a source line with Thai or other non-ASCII text — LC_ALL/LANG do not change that
  sc=(--norc --severity=style --external-sources --source-path=SCRIPTDIR --format=gcc)
  filter="cat"
  if in_gha; then filter="shellcheck_annotations"; fi
  run "$out/shellcheck.log" "$filter" "${docker_run[@]}" --name "ong-sec-shellcheck-$$" --network none \
    --entrypoint shellcheck "$ACTIONLINT_IMAGE" "${sc[@]}" -- "${files[@]}" || rc=$?
  status=$(status_of shellcheck "$rc")
  [ "$status" != error ] || echo "shellcheck exited $rc (2 = unreadable file · 3/4 = bad option · 125+ = docker)" >&2
  record "shellcheck (actionlint image)" "$status" $((SECONDS - t)) "${#files[@]} file(s) in scripts/ci"
fi

# --- summary ------------------------------------------------------------------------------------------
{
  echo "### Workflow lint (actionlint · zizmor · shellcheck)"
  echo
  echo "| check | result | time | scope |"
  echo "| --- | --- | --- | --- |"
  printf '%s' "$rows"
} >"$out/summary.md"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then cat "$out/summary.md" >>"$GITHUB_STEP_SUMMARY"; fi

case "$overall" in
  0) echo "ci-lint: clean in ${SECONDS}s — logs in $out" ;;
  1) echo "ci-lint: FAILED (findings) in ${SECONDS}s — logs in $out" >&2 ;;
  *) echo "ci-lint: ERROR (a check did not complete) in ${SECONDS}s — logs in $out" >&2 ;;
esac
exit "$overall"

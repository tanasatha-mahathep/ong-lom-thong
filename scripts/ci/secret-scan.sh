#!/usr/bin/env bash
# secret-scan.sh — secret scanning for ong-lom-thong (ring 0 `check` job + weekly security.yml)
#
# Fails on any of:
#   1. a .env / .env.* other than .env.example tracked in the index, or ever added in HEAD's history
#      (CLAUDE.md rule 8)
#   2. gitleaks over the working tree: exactly the files git would commit (tracked + untracked but not
#      ignored), so a local .env full of dev secrets is not reported while an unstaged new file is
#   3. gitleaks over the full history reachable from HEAD, merge commits included (diffed against their
#      first parent, so content that only appears in a merge resolution is scanned too)
#
# Run:      make secret-scan (= scripts/ci/secret-scan.sh) — the same command locally and in CI
# Needs:    bash (3.2+), git, docker, jq, tar · a full clone (CI: actions/checkout with fetch-depth: 0)
# Exit:     0 clean · 1 finding(s) · 2 tool or setup error (a scan that did not run never passes)
# Reports:  $ONG_SEC_OUT (default $RUNNER_TEMP or $TMPDIR, then /ong-sec)/secret-scan/{tree,history}.json
#           with secrets redacted by gitleaks (--redact); nothing is written inside the repo
# Suppress: .gitleaks.toml (allowlists, each with a description) and .gitleaksignore (fingerprints, each
#           group directly under a "# reason" comment — enforced here); inline `gitleaks:allow` is ignored
# Update:   docker buildx imagetools inspect ghcr.io/gitleaks/gitleaks:<tag> → use the index digest
set -euo pipefail

# renovate: datasource=docker depName=ghcr.io/gitleaks/gitleaks
readonly GITLEAKS_IMAGE="ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f"

# .env files that are in HEAD's history on purpose: "<full commit sha>:<path>". Add one only after every
# value in that file has been rotated, with a comment saying who rotated what and when.
ENV_HISTORY_ACK=()

SECONDS=0
die() {
  echo "secret-scan: $*" >&2
  exit 2
}
in_gha() { [ "${GITHUB_ACTIONS:-}" = true ]; }
failed=0
fail() {
  if in_gha; then echo "::error title=secret-scan::$*"; else echo "FAIL: $*"; fi
  failed=1
}

command -v git >/dev/null || die "git not found"
command -v docker >/dev/null || die "docker not found"
command -v jq >/dev/null || die "jq not found"

root=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repository"
root=$(cd "$root" && pwd -P)
cd "$root"
[ "$(git rev-parse --is-shallow-repository)" = false ] ||
  die "shallow clone — the history scan needs every commit (CI: fetch-depth: 0 · local: git fetch --unshallow)"
[ -f .gitleaks.toml ] || die ".gitleaks.toml not found in $root"

out="${ONG_SEC_OUT:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ong-sec}/secret-scan"
mkdir -p "$out"
out=$(cd "$out" && pwd -P)
case "$out/" in "$root"/*) die "report dir must be outside the repo: $out" ;; esac
rm -f "$out/tree.json" "$out/history.json" "$out/tree.log" "$out/history.log"
tree=$(mktemp -d "$out/tree.XXXXXX")
trap 'rm -rf "$tree"' EXIT

# gitleaks runs offline, unprivileged, on a read-only root filesystem, with the sources mounted read-only
docker_run=(docker run --rm --network none --user "$(id -u):$(id -g)"
  --cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs /tmp -v "$out:/out")
gitleaks_flags=(--no-banner --no-color --redact --ignore-gitleaks-allow --exit-code 99 --report-format json)

scan_status() { # <exit code> <log file> → 0 clean · 1 leaks · 2 tool error
  if grep -Eq ' (ERR|FTL) ' "$2"; then return 2; fi
  case "$1" in 0) return 0 ;; 99) return 1 ;; *) return 2 ;; esac
}

# --- 1. .env files ----------------------------------------------------------------------------------
is_env_file() { # basename rule of CLAUDE.md rule 8 and .gitignore
  case "${1##*/}" in .env.example) return 1 ;; .env | .env.*) return 0 ;; *) return 1 ;; esac
}
acked() {
  local a
  for a in ${ENV_HISTORY_ACK[@]+"${ENV_HISTORY_ACK[@]}"}; do [ "$a" = "$1" ] && return 0; done
  return 1
}

echo "==> .env guard (CLAUDE.md rule 8)"
env_hits=0
while IFS= read -r -d '' f; do
  if is_env_file "$f"; then
    fail "tracked env file: $f — git rm --cached it and rotate every value in it"
    env_hits=$((env_hits + 1))
  fi
done < <(git ls-files -z --cached)
commit=""
while IFS= read -r line; do
  case "$line" in
    "commit "*) commit=${line#commit } ;;
    "") ;;
    *)
      if is_env_file "$line" && ! acked "$commit:$line"; then
        fail "env file in history: $line (commit ${commit:0:12}) — rotate every value, then see ENV_HISTORY_ACK"
        env_hits=$((env_hits + 1))
      fi
      ;;
  esac
done < <(git -c core.quotePath=false log --format='commit %H' --name-only --diff-filter=AR \
  --full-history --diff-merges=first-parent HEAD)
echo "    $env_hits problem(s)"

# --- .gitleaksignore: each group of fingerprints sits directly under a "# reason" comment -------------
if [ -f .gitleaksignore ]; then
  ok=0 n=0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    case "$line" in
      "#"*[![:space:]#]*) ok=1 ;;
      *[![:space:]]*) [ "$ok" = 1 ] || fail ".gitleaksignore:$n: fingerprint without a '# reason' comment above its group" ;;
      *) ok=0 ;;
    esac
  done <.gitleaksignore
fi

# --- 2. working tree --------------------------------------------------------------------------------
echo "==> gitleaks: working tree (tracked + untracked, not ignored)"
files=0
while IFS= read -r -d '' f; do
  # regular files only — deleted-but-tracked paths and symlinks are skipped
  if [ -f "$f" ] && [ ! -L "$f" ]; then
    printf '%s\0' "$f"
    files=$((files + 1))
  fi
done < <(git ls-files -z --cached --others --exclude-standard) >"$out/tree.list"
tar --null -T "$out/tree.list" -cf - | tar -xf - -C "$tree"
rm -f "$out/tree.list"

rc=0
# scanned from inside /scan so report paths and fingerprints are repo-relative
"${docker_run[@]}" --name "ong-sec-gitleaks-tree-$$" -v "$tree:/scan:ro" -w /scan "$GITLEAKS_IMAGE" \
  dir "${gitleaks_flags[@]}" --config /scan/.gitleaks.toml --gitleaks-ignore-path /scan \
  --report-path /out/tree.json . 2>"$out/tree.log" || rc=$?
cat "$out/tree.log" >&2
tree_status=0
scan_status "$rc" "$out/tree.log" || tree_status=$?
[ "$tree_status" != 2 ] || die "gitleaks (working tree) failed with exit $rc — see $out/tree.log"
echo "    $files files"

# --- 3. history -------------------------------------------------------------------------------------
echo "==> gitleaks: history reachable from HEAD (merge commits against their first parent)"
# In a git worktree .git is a file pointing into the main repository's .git: mount that as well
# (read-only, same absolute path) so git inside the container can read the objects.
common=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)
mounts=(-v "$root:$root:ro")
case "$common/" in "$root"/*) ;; *) mounts+=(-v "$common:$common:ro") ;; esac
commits=$(git rev-list --count HEAD)
rc=0
"${docker_run[@]}" --name "ong-sec-gitleaks-history-$$" "${mounts[@]}" -w "$root" \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0='*' "$GITLEAKS_IMAGE" \
  git "${gitleaks_flags[@]}" --config "$root/.gitleaks.toml" --gitleaks-ignore-path "$root" \
  --log-opts="--full-history --diff-merges=first-parent HEAD" \
  --report-path /out/history.json "$root" 2>"$out/history.log" || rc=$?
cat "$out/history.log" >&2
history_status=0
scan_status "$rc" "$out/history.log" || history_status=$?
[ "$history_status" != 2 ] || die "gitleaks (history) failed with exit $rc — see $out/history.log"
scanned=$(sed -n 's/.* \([0-9][0-9]*\) commits scanned.*/\1/p' "$out/history.log" | tail -n 1)
# gitleaks exits 0 with "0 commits scanned" when git fails inside the container: never count that as clean
{ [ -n "$scanned" ] && [ "$scanned" -gt 0 ]; } || die "gitleaks scanned no commits (git rev-list counts $commits)"
echo "    gitleaks scanned $scanned commits (git rev-list: $commits; commits that only delete lines are not counted)"

# --- report: gitleaks already redacted the values; only rule, location and fingerprint are shown ------
report() { # <json> <label>
  [ -s "$1" ] || return 0
  jq -r --arg label "$2" '.[] | [$label, .RuleID, .File, (.StartLine | tostring),
    (if (.Commit // "") == "" then "-" else .Commit[0:12] end), .Fingerprint] | @tsv' "$1"
}
findings=$(
  report "$out/tree.json" tree
  report "$out/history.json" history
)
if [ -n "$findings" ]; then
  echo
  echo "Findings (values redacted):"
  printf '%s\n' "$findings" | while IFS=$'\t' read -r where rule file line sha fp; do
    echo "  [$where] $rule  $file:$line  commit $sha"
    echo "      fingerprint: $fp"
    if in_gha && [ "$where" = tree ]; then
      echo "::error file=$file,line=$line,title=gitleaks $rule::possible secret (value redacted)"
    fi
  done
  failed=1
fi

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Secret scan (gitleaks)"
    echo
    echo "| check | result |"
    echo "| --- | --- |"
    echo "| .env guard | $env_hits problem(s) |"
    echo "| working tree | $files files · $([ "$tree_status" = 0 ] && echo clean || echo findings) |"
    echo "| history | $scanned/$commits commits · $([ "$history_status" = 0 ] && echo clean || echo findings) |"
    if [ -n "$findings" ]; then
      echo
      echo "| where | rule | location | commit |"
      echo "| --- | --- | --- | --- |"
      printf '%s\n' "$findings" | while IFS=$'\t' read -r where rule file line sha _; do
        echo "| $where | \`$rule\` | \`$file:$line\` | \`$sha\` |"
      done
    fi
  } >>"$GITHUB_STEP_SUMMARY"
fi

if [ "$failed" = 0 ]; then
  echo "secret-scan: clean in ${SECONDS}s — reports in $out"
else
  echo "secret-scan: FAILED in ${SECONDS}s — reports in $out" >&2
  exit 1
fi

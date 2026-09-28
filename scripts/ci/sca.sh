#!/usr/bin/env bash
# sca.sh — software composition analysis: known vulnerabilities in pnpm-lock.yaml (OSV-Scanner)
#
# Queries OSV.dev (GitHub Advisory Database, OpenSSF malicious packages, …) for every package version in
# the lockfile. Fails on HIGH/CRITICAL (CVSS >= 7.0 or advisory severity HIGH/CRITICAL, whichever is
# higher), on malicious packages (MAL-*) and on advisories without any severity (fail-closed).
# MEDIUM/LOW are listed but do not fail. Ignores live in osv-scanner.toml with a reason and an expiry.
#
# Run:      make sca (= scripts/ci/sca.sh) — the same command locally and in CI
#           scripts/ci/sca.sh <path/to/pnpm-lock.yaml>  scans another lockfile, e.g. production's:
#           git show origin/main:pnpm-lock.yaml > /tmp/prod/pnpm-lock.yaml && scripts/ci/sca.sh /tmp/prod/pnpm-lock.yaml
# Needs:    bash (3.2+), git, docker, jq · network access to api.osv.dev (only the lockfile is mounted
#           into the container, so package names and versions are all that leaves the machine)
# Exit:     0 no blocking finding · 1 blocking finding(s) or an invalid ignore · 2 tool or setup error
# Reports:  $ONG_SEC_OUT (default $RUNNER_TEMP or $TMPDIR, then /ong-sec)/sca/osv.json (+ findings.tsv)
# Update:   docker buildx imagetools inspect ghcr.io/google/osv-scanner:<tag> → use the index digest
set -euo pipefail

# renovate: datasource=docker depName=ghcr.io/google/osv-scanner
readonly OSV_IMAGE="ghcr.io/google/osv-scanner:v2.6.0@sha256:afd838850ac1a0fcc15ff4a041dc9ba11123c3f0d2666217a5f0fcf9222b55fa"
readonly MAX_IGNORE_DAYS=90

SECONDS=0
die() {
  echo "sca: $*" >&2
  exit 2
}
in_gha() { [ "${GITHUB_ACTIONS:-}" = true ]; }

command -v git >/dev/null || die "git not found"
command -v docker >/dev/null || die "docker not found"
command -v jq >/dev/null || die "jq not found"

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
root=$(git -C "$here" rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repository"
root=$(cd "$root" && pwd -P)
# an explicit lockfile is relative to the caller's directory; the default is the repo's own
lock=${1:-$root/pnpm-lock.yaml}
[ -f "$lock" ] || die "lockfile not found: $lock"
lock="$(cd "$(dirname "$lock")" && pwd -P)/$(basename "$lock")"
cd "$root"
config="$root/osv-scanner.toml"
[ -f "$config" ] || die "osv-scanner.toml not found in $root"
[ "$(basename "$lock")" = pnpm-lock.yaml ] || die "expected a file named pnpm-lock.yaml, got $lock"

out="${ONG_SEC_OUT:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ong-sec}/sca"
probe=$out # refuse before mkdir, so not even an empty directory lands in the repo
while [ ! -d "$probe" ]; do probe=$(dirname "$probe"); done
case "$(cd "$probe" && pwd -P)/" in "$root"/*) die "report dir must be outside the repo: $out" ;; esac
mkdir -p "$out"
out=$(cd "$out" && pwd -P)
case "$out/" in "$root"/*) die "report dir must be outside the repo: $out" ;; esac
rm -f "$out/osv.json" "$out/osv.log" "$out/findings.tsv"

# --- 1. ignore policy: reason + expiry (at most MAX_IGNORE_DAYS ahead) on every entry ----------------
echo "==> ignore policy (osv-scanner.toml)"
now=$(jq -rn 'now | strftime("%Y-%m-%dT%H:%M:%SZ")')
horizon=$(jq -rn --argjson d "$MAX_IGNORE_DAYS" 'now + $d * 86400 | strftime("%Y-%m-%dT%H:%M:%SZ")')
policy_rc=0
awk -v now="$now" -v horizon="$horizon" -v days="$MAX_IGNORE_DAYS" '
  function value(line) { sub(/^[^=]*=[[:space:]]*/, "", line); sub(/[[:space:]]+#.*$/, "", line); return line }
  function problem(msg) { printf "osv-scanner.toml:%d: [[%s]] %s: %s\n", start, kind, (id == "" ? "?" : id), msg; bad = 1 }
  function check(   key) {
    if (kind == "") return
    key = (kind == "IgnoredVulns") ? "ignoreUntil" : "effectiveUntil"
    if (reason == "") problem("no reason")
    if (until == "") problem("no " key " (expiry)")
    else if (until !~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z$/)
      problem(key " must be RFC 3339 UTC, e.g. 2026-12-31T00:00:00Z")
    else if (until > horizon) problem(key " " until " is more than " days " days ahead")
    else if (until < now) printf "osv-scanner.toml:%d: note: %s expired on %s and no longer applies: remove it\n", start, id, until
    kind = ""
  }
  /^[[:space:]]*\[\[/ {
    check(); kind = $0; gsub(/[][[:space:]]/, "", kind); start = NR; id = reason = until = ""
    if (kind != "IgnoredVulns" && kind != "PackageOverrides") { printf "osv-scanner.toml:%d: unexpected [[%s]]\n", NR, kind; bad = 1; kind = "" }
    next
  }
  /^[[:space:]]*\[/ { if (kind == "" || $0 !~ ("^[[:space:]]*\\[" kind "\\.")) check(); next }
  kind != "" && /^[[:space:]]*(id|name)[[:space:]]*=/ { id = value($0); gsub(/"/, "", id) }
  kind != "" && /^[[:space:]]*reason[[:space:]]*=/ { v = value($0); gsub(/^"|"$/, "", v); if (v ~ /[^[:space:]]/) reason = v }
  kind != "" && /^[[:space:]]*(ignoreUntil|effectiveUntil)[[:space:]]*=/ { until = value($0); gsub(/"/, "", until) }
  END { check(); exit bad }
' "$config" || policy_rc=$?
case "$policy_rc" in 0) echo "    ok" ;; 1) ;; *) die "could not check osv-scanner.toml (awk exit $policy_rc)" ;; esac

# --- 2. scan -----------------------------------------------------------------------------------------
echo "==> osv-scanner: ${lock#"$root"/}"
rc=0
docker run --rm --name "ong-sec-osv-$$" --user "$(id -u):$(id -g)" \
  --cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs /tmp -e HOME=/tmp \
  -v "$lock:/src/pnpm-lock.yaml:ro" -v "$config:/src/osv-scanner.toml:ro" -v "$out:/out" \
  "$OSV_IMAGE" scan source --lockfile /src/pnpm-lock.yaml --config /src/osv-scanner.toml \
  --no-resolve --all-packages --format json --output-file /out/osv.json 2>"$out/osv.log" || rc=$?
cat "$out/osv.log" >&2
# osv-scanner: 0 = no vulnerabilities, 1 = vulnerabilities found, anything else = the scan did not complete
case "$rc" in 0 | 1) ;; *) die "osv-scanner failed with exit $rc — see $out/osv.log" ;; esac
jq -e '.results | type == "array"' "$out/osv.json" >/dev/null 2>&1 || die "no JSON report from osv-scanner"
packages=$(jq '[.results[].packages[]?] | length' "$out/osv.json")
[ "$packages" -gt 0 ] || die "osv-scanner found no packages in the lockfile"

# --- 3. gate -------------------------------------------------------------------------------------------
# One row per advisory group (aliases merged): level, score, package, version, ids, fixed versions, summary.
# level = max(CVSS band, advisory severity); MAL-* = CRITICAL; no severity at all = UNKNOWN (blocking).
jq -r '
  def band: if . >= 9 then 4 elif . >= 7 then 3 elif . >= 4 then 2 elif . > 0 then 1 else 0 end;
  def rank: {"CRITICAL": 4, "HIGH": 3, "MODERATE": 2, "MEDIUM": 2, "LOW": 1}[ascii_upcase] // 0;
  .results[].packages[]? | . as $p | ($p.groups // [])[] | . as $g
  | [($p.vulnerabilities // [])[] | select(.id as $id | $g.ids | index($id))] as $vs
  | (($g.max_severity // "") | if . == "" then 0 else (tonumber? // 0) end) as $score
  | ([$vs[] | (.database_specific.severity? // "") | select(type == "string") | rank] | max // 0) as $adv
  | (if any($g.ids[]; startswith("MAL-")) then 4
     elif ([$score | band, $adv] | max) > 0 then ([$score | band, $adv] | max)
     else 5 end) as $lvl
  | [ (["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"][$lvl]),
      (if $score > 0 then ($score | tostring) else "-" end),
      $p.package.name, $p.package.version,
      ([($g.aliases // []) + $g.ids | .[] | select(startswith("GHSA-") or startswith("CVE-") or startswith("MAL-"))]
        | unique | if length == 0 then $g.ids else . end | join(" ")),
      ([$vs[].affected[]? | select(.package.name == $p.package.name) | .ranges[]?.events[]? | .fixed // empty]
        | unique | if length == 0 then "none" else join(" ") end),
      (($vs[0].summary // $vs[0].details // "") | gsub("[\t\n\r]"; " ") | .[0:110]) ]
  | @tsv' "$out/osv.json" | sort -u >"$out/findings.tsv"

order() { # blocking levels first
  awk -F '\t' 'BEGIN { o["CRITICAL"]=1; o["HIGH"]=2; o["UNKNOWN"]=3; o["MEDIUM"]=4; o["LOW"]=5; o["NONE"]=6 }
    { print o[$1] "\t" $0 }' "$out/findings.tsv" | sort -t "$(printf '\t')" -k1,1n -k4,4 | cut -f 2-
}
blocking=0 total=0
rows=$(order)
if [ -n "$rows" ]; then
  echo
  printf ' %-8s %-5s %-34s %-40s %s\n' LEVEL CVSS PACKAGE ADVISORY "FIXED IN"
  while IFS=$'\t' read -r level score name version ids fixed summary; do
    total=$((total + 1))
    mark=" "
    case "$level" in CRITICAL | HIGH | UNKNOWN)
      blocking=$((blocking + 1))
      mark="!"
      if in_gha; then echo "::error title=sca $level::$name@$version $ids — fixed in: $fixed"; fi
      ;;
    esac
    printf '%s%-8s %-5s %-34s %-40s %s\n' "$mark" "$level" "$score" "$name@$version" "$ids" "$fixed"
    printf '          %s\n' "$summary"
  done <<EOF
$rows
EOF
fi

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Dependency vulnerabilities (OSV-Scanner · ${lock#"$root"/})"
    echo
    echo "$packages packages · $total advisory group(s) · **$blocking blocking** (HIGH/CRITICAL/malicious/unknown)"
    if [ -n "$rows" ]; then
      echo
      echo "| level | CVSS | package | advisory | fixed in |"
      echo "| --- | --- | --- | --- | --- |"
      while IFS=$'\t' read -r level score name version ids fixed _; do
        echo "| $level | $score | \`$name@$version\` | $ids | $fixed |"
      done <<EOF
$rows
EOF
    fi
  } >>"$GITHUB_STEP_SUMMARY"
fi

echo
echo "sca: $packages packages · $total advisory group(s) · $blocking blocking · ${SECONDS}s — report in $out"
if [ "$blocking" -gt 0 ] || [ "$policy_rc" != 0 ]; then
  echo "sca: FAILED — upgrade (Renovate PR to dev) or add a reasoned, expiring ignore to osv-scanner.toml" >&2
  exit 1
fi

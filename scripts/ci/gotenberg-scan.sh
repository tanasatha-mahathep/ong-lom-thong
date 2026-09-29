#!/usr/bin/env bash
# gotenberg-scan.sh — SBOM + vulnerability gate for the Gotenberg image (services/gotenberg/Dockerfile)
#
# Builds the image Railway deploys for PDF rendering (or reuses one with SKIP_BUILD=1), then with Trivy:
#   1. SBOM (CycloneDX) with NTIA minimum metadata  → $out/sbom.cdx.json
#   2. full report, every severity, nothing ignored  → $out/trivy-report.json + a severity table
#   3. gate: CRITICAL with a fix available fails. HIGH is reported but does not fail: Gotenberg bundles
#      Chromium, whose HIGH findings are only fixed by an upstream Gotenberg release (we pin tag + digest
#      and bump when one ships — see docs/proposals/railway-deploy-attested-image.md)
# The service is only reachable on Railway's private network behind basic auth, with LibreOffice routes
# off and outbound fetches denied (CMD in the Dockerfile) — that is what makes reporting HIGH acceptable.
#
# Run:      make gotenberg-scan (= scripts/ci/gotenberg-scan.sh) — the same command locally and in CI
#           SKIP_BUILD=1 IMAGE=<tag> scripts/ci/gotenberg-scan.sh   scan an image you already have
# Needs:    bash (3.2+), git, docker, jq · network to pull the Trivy image and its vulnerability DB
# Disk:     the image is saved to a tar (~1.7 GB) in $out while scanning and deleted afterwards
# Exit:     0 no CRITICAL with a fix · 1 blocking finding(s) · 2 tool or setup error
# Reports:  $ONG_SEC_OUT (default $RUNNER_TEMP or $TMPDIR, then /ong-sec)/gotenberg/
# Update:   docker buildx imagetools inspect aquasec/trivy:<tag> → use the index digest
set -euo pipefail

# renovate: datasource=docker depName=aquasec/trivy
readonly TRIVY_IMAGE="aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969"

SECONDS=0
die() {
  echo "gotenberg-scan: $*" >&2
  exit 2
}

command -v git >/dev/null || die "git not found"
command -v docker >/dev/null || die "docker not found"
command -v jq >/dev/null || die "jq not found"

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
root=$(git -C "$here" rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repository"
root=$(cd "$root" && pwd -P)
cd "$root"

image=${IMAGE:-ong-gotenberg:scan}
repo=${GITHUB_REPOSITORY:-tanasatha-mahathep/ong-lom-thong}
sha=${GITHUB_SHA:-$(git rev-parse HEAD)}

out="${ONG_SEC_OUT:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ong-sec}/gotenberg"
mkdir -p "$out"
out=$(cd "$out" && pwd -P)
case "$out/" in "$root"/*) die "report dir must be outside the repo: $out" ;; esac
cache="${TRIVY_CACHE_DIR:-$out/../trivy-cache}"
mkdir -p "$cache"
cache=$(cd "$cache" && pwd -P)
tar="$out/gotenberg-image.tar"
rm -f "$out/sbom.cdx.json" "$out/trivy-report.json" "$out/gate.txt" "$tar"
trap 'rm -f "$tar"' EXIT

if [ "${SKIP_BUILD:-}" = 1 ]; then
  docker image inspect "$image" >/dev/null 2>&1 || die "SKIP_BUILD=1 but image $image does not exist"
else
  echo "==> build services/gotenberg → $image"
  docker build -q -t "$image" services/gotenberg >/dev/null
fi
echo "==> save $image (scanned offline from a tar: no docker socket inside the scanner)"
docker save "$image" -o "$tar"

trivy() {
  docker run --rm --name "ong-sec-trivy-$$" --user "$(id -u):$(id -g)" \
    --cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs /tmp -e HOME=/tmp \
    -e TRIVY_CACHE_DIR=/cache -e TRIVY_NO_PROGRESS=true -e TRIVY_TIMEOUT=15m \
    -e TRIVY_DISABLE_TELEMETRY=true -e TRIVY_SKIP_VERSION_CHECK=true \
    -v "$cache:/cache" -v "$out:/out" "$TRIVY_IMAGE" "$@"
}

echo "==> SBOM (CycloneDX)"
trivy image --input /out/gotenberg-image.tar --format cyclonedx --output /out/sbom.raw.json
jq --arg repo "$repo" --arg sha "$sha" '.metadata.authors = [{name: "scripts/ci/gotenberg-scan.sh, \($repo)"}]
  | .metadata.supplier = {name: ($repo | split("/")[0]), url: ["https://github.com/\($repo)"]}
  | .metadata.lifecycles = [{phase: "post-build"}]
  | .metadata.component.name = "\($repo)/gotenberg" | .metadata.component.version = $sha' \
  "$out/sbom.raw.json" >"$out/sbom.cdx.json"
rm -f "$out/sbom.raw.json"
jq -e '.bomFormat == "CycloneDX" and (.components | length > 0)' "$out/sbom.cdx.json" >/dev/null ||
  die "SBOM has no components"

echo "==> vulnerability report (every severity, nothing suppressed)"
trivy image --input /out/gotenberg-image.tar --scanners vuln --format json --output /out/trivy-report.json
jq -e '.Results | type == "array"' "$out/trivy-report.json" >/dev/null || die "no JSON report from trivy"

table=$(jq -r '"| Severity | Findings | Fix available |", "| --- | --: | --: |",
  ([.Results[] | (.Vulnerabilities // [])[]] | group_by(.Severity)[]
  | "| \(.[0].Severity) | \(length) | \(map(select((.FixedVersion // "") != "")) | length) |")' \
  "$out/trivy-report.json")
echo "$table"

# gate: CRITICAL with a fixed version available (same meaning as trivy --severity CRITICAL --ignore-unfixed)
jq -r '[.Results[] | .Target as $t | (.Vulnerabilities // [])[]
  | select(.Severity == "CRITICAL" and (.FixedVersion // "") != "")
  | "\(.VulnerabilityID)\t\(.PkgName)@\(.InstalledVersion)\tfixed in \(.FixedVersion)\t\($t)"] | unique[]' \
  "$out/trivy-report.json" >"$out/gate.txt"
blocking=$(wc -l <"$out/gate.txt" | tr -d ' ')

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Trivy — Gotenberg image (gate: CRITICAL with a fix · HIGH reported)"
    echo
    echo "$table"
    echo
    echo "**$blocking blocking**"
    if [ "$blocking" -gt 0 ]; then
      echo
      sed 's/^/- /' "$out/gate.txt"
    fi
  } >>"$GITHUB_STEP_SUMMARY"
fi

echo
echo "gotenberg-scan: $blocking blocking (CRITICAL with a fix) · ${SECONDS}s — reports in $out"
if [ "$blocking" -gt 0 ]; then
  cat "$out/gate.txt" >&2
  echo "gotenberg-scan: FAILED — bump services/gotenberg/Dockerfile to a Gotenberg release that fixes these" >&2
  exit 1
fi

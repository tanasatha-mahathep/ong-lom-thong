#!/usr/bin/env bash
# verify-image.sh — check that an image in GHCR was built and attested by this repo's ci.yml
#
#   scripts/ci/verify-image.sh <commit sha | tag | sha256:digest> [api|gotenberg ...]   (default: api gotenberg)
#   make verify-image REF=<sha> [IMAGES="api"]
#
# For each image verifies, with Sigstore via `gh attestation verify`:
#   1. SLSA build provenance — signed by .github/workflows/ci.yml of this repo on a GitHub-hosted runner
#   2. the CycloneDX SBOM attestation — same signer
# Run it before deploying a digest by hand; Railway's pre-deploy should run the same command (see
# docs/proposals/railway-deploy-attested-image.md). A digest ref is the strongest: a tag can move.
#
# Needs:    gh (logged in, or GH_TOKEN) · network to ghcr.io and GitHub's attestation API
# Env:      OWNER_REPO (default tanasatha-mahathep/ong-lom-thong) · REGISTRY (default ghcr.io)
# Exit:     0 every image verified · 1 a verification failed · 2 usage/setup error
set -euo pipefail

die() {
  echo "verify-image: $*" >&2
  exit 2
}
[ $# -ge 1 ] && [ -n "$1" ] || die "usage: $0 <commit sha | tag | sha256:digest> [api|gotenberg ...]"
ref=$1
shift
images=("$@")
[ ${#images[@]} -gt 0 ] || images=(api gotenberg)
command -v gh >/dev/null || die "gh not found"

repo=${OWNER_REPO:-tanasatha-mahathep/ong-lom-thong}
registry=${REGISTRY:-ghcr.io}
workflow="$repo/.github/workflows/ci.yml"
sep=":"
if [[ "$ref" == sha256:* ]]; then
  [[ "$ref" =~ ^sha256:[0-9a-f]{64}$ ]] || die "bad digest: $ref"
  sep="@"
elif ! [[ "$ref" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
  die "bad tag: $ref"
fi

rc=0
for name in "${images[@]}"; do
  case "$name" in api | gotenberg) ;; *) die "unknown image: $name (api | gotenberg)" ;; esac
  oci="oci://$registry/$repo/$name$sep$ref"
  echo "==> $oci"
  for predicate in https://slsa.dev/provenance/v1 https://cyclonedx.org/bom; do
    if gh attestation verify "$oci" --repo "$repo" --signer-workflow "$workflow" \
      --predicate-type "$predicate" --deny-self-hosted-runners >/dev/null; then
      echo "    ok  $predicate"
    else
      echo "    FAIL $predicate" >&2
      rc=1
    fi
  done
done
if [ "$rc" != 0 ]; then
  echo "verify-image: FAILED — do not deploy" >&2
  exit 1
fi
echo "verify-image: every image verified"

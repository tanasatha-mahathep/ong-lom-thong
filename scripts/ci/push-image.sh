#!/usr/bin/env bash
# push-image.sh — push the exact image CI tested to the registry, tagged with the commit SHA and the branch
#
#   scripts/ci/push-image.sh <local image> <name>     e.g. scripts/ci/push-image.sh ong-api:ci api
#
# Pushes <local image> as $REGISTRY/$OWNER_REPO/<name>:<commit sha> and :<branch> (sanitised), then prints
# the manifest digest the registry answered. The attestation steps in ci.yml sign that digest, so what
# Railway deploys by digest is byte-for-byte what smoke, Trivy and e2e tested (SLSA Build L2+ provenance).
# The SHA tag is written first and never moved; the branch tag is a convenience pointer that moves.
#
# Env:      REGISTRY (default ghcr.io) · OWNER_REPO (default $GITHUB_REPOSITORY, lower-cased)
#           GITHUB_SHA / BRANCH (default: git HEAD / current branch)
#           GH_TOKEN → docker login to ghcr.io (CI passes github.token with packages: write, job-scoped).
#           Without GH_TOKEN the script uses whatever `docker login` you already have (local registry test:
#           docker run -d -p 127.0.0.1:5055:5000 registry:3 && REGISTRY=localhost:5055 scripts/ci/push-image.sh …)
# Output:   name=<registry/repo/name> and digest=sha256:… on stdout and in $GITHUB_OUTPUT when set
# Exit:     0 pushed · 2 setup error or push failed
set -euo pipefail

die() {
  echo "push-image: $*" >&2
  exit 2
}
[ $# -eq 2 ] || die "usage: $0 <local image> <name>"
local_image=$1
name=$2
case "$name" in *[!a-z0-9._-]* | "") die "name must be lower-case [a-z0-9._-]: $name" ;; esac

command -v docker >/dev/null || die "docker not found"
docker image inspect "$local_image" >/dev/null 2>&1 || die "image not found: $local_image"

registry=${REGISTRY:-ghcr.io}
repo=${OWNER_REPO:-${GITHUB_REPOSITORY:-tanasatha-mahathep/ong-lom-thong}}
repo=$(printf '%s' "$repo" | tr '[:upper:]' '[:lower:]') # OCI repository names are lower-case
sha=${GITHUB_SHA:-$(git rev-parse HEAD)}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "not a full commit SHA: $sha"
branch=${BRANCH:-$(git branch --show-current)}
# docker tag grammar: [A-Za-z0-9_][A-Za-z0-9_.-]{0,127} — ci/foo → ci-foo
branch_tag=$(printf '%s' "$branch" | tr -c 'A-Za-z0-9_.-' '-' | sed 's/^[.-]*//' | cut -c 1-128)
ref="$registry/$repo/$name"

if [ -n "${GH_TOKEN:-}" ]; then
  # the token goes through stdin only — never on a command line or in the log
  printf '%s' "$GH_TOKEN" | docker login "$registry" -u "${GITHUB_ACTOR:-x-access-token}" --password-stdin >/dev/null ||
    die "docker login $registry failed"
fi

tags=("$sha")
[ -z "$branch_tag" ] || tags+=("$branch_tag")
digest=""
for tag in "${tags[@]}"; do
  docker tag "$local_image" "$ref:$tag"
  log=$(docker push "$ref:$tag" 2>&1) || {
    echo "$log" >&2
    die "push $ref:$tag failed"
  }
  echo "$log" | tail -1
  d=$(echo "$log" | grep -oE 'digest: sha256:[0-9a-f]{64}' | tail -1 | cut -d ' ' -f 2)
  [ -n "$d" ] || die "no digest in the push output for $ref:$tag"
  # every tag must point at the same manifest — anything else means the local image changed mid-push
  [ -z "$digest" ] || [ "$d" = "$digest" ] || die "digest mismatch: $ref:$tag is $d, expected $digest"
  digest=$d
  docker rmi "$ref:$tag" >/dev/null # the local image stays; only the extra tag goes
done

echo "name=$ref"
echo "digest=$digest"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "name=$ref"
    echo "digest=$digest"
  } >>"$GITHUB_OUTPUT"
fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "- pushed \`$ref@$digest\` (tags \`$sha\` · \`$branch_tag\`)" >>"$GITHUB_STEP_SUMMARY"
fi

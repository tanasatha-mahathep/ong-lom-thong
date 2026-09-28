#!/usr/bin/env bash
# e2e stack (compose project ong-e2e) — one entry point for make, CI and the Playwright setup project.
#
#   stack.sh up            generate this run's secrets, build what is missing, start, wait until healthy
#   stack.sh down          remove containers, network, volumes and the secrets (safe to run any time)
#   stack.sh logs|ps|exec  pass through to docker compose with the same project/file/secrets
#
# API_IMAGE=<tag> (CI): use that docker-loaded image and never rebuild it — only Gotenberg is built here.
# Secrets live outside the repo (E2E_STATE_DIR) so they never reach git or the docker build context.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project=ong-e2e
state_dir="${E2E_STATE_DIR:-${TMPDIR:-/tmp}/ong-e2e}"
state_dir="${state_dir%/}"
secrets="$state_dir/stack.env"

compose() {
  docker compose --project-name "$project" --file "$here/compose.yml" --env-file "$secrets" "$@"
}

# hex only: safe inside URLs (DATABASE_URL) and shell words
new_secret() {
  openssl rand -hex 32
}

ensure_secrets() {
  [[ -s "$secrets" ]] && return 0
  mkdir -p "$state_dir"
  chmod 700 "$state_dir"
  (
    umask 077
    {
      echo "# ong-e2e stack secrets — generated $(date -u +%Y-%m-%dT%H:%M:%SZ), removed by stack.sh down"
      echo "E2E_POSTGRES_PASSWORD=$(new_secret)"
      echo "E2E_BETTER_AUTH_SECRET=$(new_secret)"
      echo "E2E_S3_ACCESS_KEY=e2e$(openssl rand -hex 8)"
      echo "E2E_S3_SECRET_KEY=$(new_secret)"
      echo "E2E_GOTENBERG_PASSWORD=$(new_secret)"
    } >"$secrets"
  )
}

down() {
  ensure_secrets # compose needs the variables to parse the file, even to remove it
  compose down --volumes --remove-orphans --timeout 10
  # only what this script and the setup project write — never a blanket rm -rf of a configurable path
  rm -f "$secrets" "$state_dir/accounts.json"
  rmdir "$state_dir" 2>/dev/null || true
}

diagnose() {
  echo "--- ong-e2e: stack did not become healthy" >&2
  compose ps --all >&2 || true
  compose logs --no-color --timestamps --tail=200 >&2 || true
}

cmd="${1:-}"
[[ $# -gt 0 ]] && shift
case "$cmd" in
  up)
    ensure_secrets
    started=$SECONDS
    if [[ -n "${API_IMAGE:-}" ]]; then
      docker image inspect "$API_IMAGE" >/dev/null 2>&1 || {
        echo "API_IMAGE=$API_IMAGE is not loaded — docker load it first" >&2
        exit 1
      }
      compose build gotenberg
      up_args=(--no-build)
    else
      # local: rebuild from the working tree (layer cache keeps an unchanged tree fast)
      up_args=(--build)
    fi
    if ! compose up --detach --wait --wait-timeout "${E2E_WAIT_TIMEOUT:-300}" "${up_args[@]}"; then
      diagnose
      if [[ "${E2E_KEEP_ON_FAILURE:-0}" != 1 ]]; then
        down
      fi
      exit 1
    fi
    echo "ong-e2e up in $((SECONDS - started))s — api http://localhost:28787 · gotenberg http://localhost:23000"
    ;;
  down)
    down
    ;;
  logs | ps | exec | compose)
    ensure_secrets
    [[ "$cmd" == compose ]] || set -- "$cmd" "$@"
    compose "$@"
    ;;
  *)
    echo "usage: stack.sh up|down|logs|ps|exec|compose [args…]" >&2
    exit 2
    ;;
esac

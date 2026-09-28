#!/usr/bin/env bash
# backend probes ด้วย pytest ของเราเอง — ไม่ใช้ TestSprite · ไม่มีอะไรออกนอกเครื่องนอกจากคำขอไปที่ URL เป้าหมาย
#   bash scripts/probe.sh <base-url>        (หรือ ONG_BASE_URL=<base-url>)
#   เช่น http://localhost:28787 (stack e2e) · https://ong-lom-thong-testing.up.railway.app
# production ต้อง CONFIRM=yes (อ่านอย่างเดียวก็จริง แต่ให้ตั้งใจ) · venv อยู่ .venv (gitignore) · ติดตั้งแบบ --require-hashes
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

base_url="${1:-${ONG_BASE_URL:-}}"
base_url="${base_url%/}"
case "$base_url" in
  https://?* | http://localhost | http://localhost:* | http://127.0.0.1 | http://127.0.0.1:*) ;;
  *)
    echo "ต้องระบุ URL เป้าหมาย: https://… หรือ http://localhost:<port> — ได้ '${base_url}'" >&2
    exit 2
    ;;
esac
host="${base_url#*://}"
host="${host%%/*}"
if [ "$host" = "ong-lom-thong.up.railway.app" ] && [ "${CONFIRM:-}" != yes ]; then
  echo "${host} คือ production — รันซ้ำด้วย CONFIRM=yes ถ้าตั้งใจ" >&2
  exit 2
fi

python="${PYTHON:-python3}"
"$python" -c 'import sys; sys.exit(sys.version_info < (3, 9))' || {
  echo "ต้องใช้ Python ≥ 3.9 (${python})" >&2
  exit 2
}
stamp=".venv/requirements.sha256"
want="$("$python" -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' requirements.txt)"
if [ ! -x .venv/bin/python ] || [ "$(cat "$stamp" 2>/dev/null)" != "$want" ]; then
  "$python" -m venv .venv
  .venv/bin/python -m pip install --disable-pip-version-check --quiet --require-hashes --only-binary=:all: -r requirements.txt
  echo "$want" >"$stamp"
fi

mkdir -p reports
echo "probe → ${base_url}"
ONG_BASE_URL="$base_url" .venv/bin/python -m pytest --junitxml=reports/probe-junit.xml "${@:2}"

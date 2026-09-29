#!/usr/bin/env bash
# สำรองข้อมูลรายคืน — Railway cron service (ประกาศใน .railway/railway.ts · วิธีใช้/กู้คืน: .railway/README.md)
#
# 1. database: pg_dump -Fc → อ่านกลับทั้งไฟล์ (pg_restore --file=/dev/null) → อัปโหลด
#    → ยืนยันว่าอยู่ในปลายทาง → ลบ dump เก่าตาม BACKUP_KEEP_DAILY / BACKUP_KEEP_MONTHLY
# 2. files: rclone copy (ไม่ใช่ sync — ไฟล์ที่ถูกลบจากต้นทางไม่ถูกลบจากสำเนา) · --immutable = ไฟล์ที่มีอยู่แล้ว
#    แต่เนื้อหาต่าง → fail ไม่เขียนทับ (ใบรับซื้อ/สำเนาบัตรเป็นเอกสารที่ห้ามแก้)
#
# สองส่วนแยกกัน: ส่วนหนึ่งพังอีกส่วนยังทำ · จบด้วย exit ≠ 0 ถ้าส่วนใดพัง (Railway แสดง run นั้นเป็น failed)
# ทั้งรอบมีเส้นตาย (BACKUP_TIMEOUT_SECONDS) — รอบที่ค้าง Railway จะข้ามรอบถัด ๆ ไปทั้งหมด (backup หยุดเงียบ)
# ค่าทั้งหมดมาจาก env (ไม่มี rclone.conf) — รายการตัวแปร: .railway/README.md หัวข้อ "สำรองข้อมูลรายคืน"
set -euo pipefail
# bash ≥ 4.4 (ใน image) · bash 3.2 ของ macOS ไม่มี — ฟังก์ชันที่เรียกใน $(…) จึง return รหัสผิดพลาดเองทุกจุด
shopt -s inherit_errexit 2>/dev/null || true

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "$here/lib.sh"

log() { printf 'backup: %s\n' "$*"; }
fail() {
  printf 'backup: ERROR: %s\n' "$*" >&2
  exit 1
}

require() {
  local name missing=()
  for name in "$@"; do
    [[ -n ${!name:-} ]] || missing+=("$name")
  done
  ((${#missing[@]} == 0)) || fail "missing required variables: ${missing[*]}"
}

# rclone remote จาก env ล้วน (RCLONE_CONFIG_<REMOTE>_<OPTION>) — ค่าลับไม่ผ่าน argv จึงไม่โผล่ใน process list/log
# no_check_bucket: ไม่พยายามสร้าง bucket (key ของ bucket เดียวสร้าง bucket ไม่ได้ และไม่ควรต้องสร้าง)
configure_remote() {
  local remote=$1 provider=$2 endpoint=$3 region=$4 access_key=$5 secret_key=$6 path_style=$7
  export "RCLONE_CONFIG_${remote}_TYPE=s3"
  export "RCLONE_CONFIG_${remote}_PROVIDER=$provider"
  export "RCLONE_CONFIG_${remote}_ENV_AUTH=false"
  export "RCLONE_CONFIG_${remote}_ENDPOINT=$endpoint"
  export "RCLONE_CONFIG_${remote}_REGION=$region"
  export "RCLONE_CONFIG_${remote}_ACCESS_KEY_ID=$access_key"
  export "RCLONE_CONFIG_${remote}_SECRET_ACCESS_KEY=$secret_key"
  export "RCLONE_CONFIG_${remote}_FORCE_PATH_STYLE=$path_style"
  export "RCLONE_CONFIG_${remote}_NO_CHECK_BUCKET=true"
}

# คำสั่งภายนอกที่อาจค้าง (pg_dump · pg_restore · rclone) รันผ่านตัวนี้: ถึงเส้นตายของรอบ = TERM แล้ว KILL
# อีก 30 วินาทีต่อมา · ไม่ครอบ timeout ที่ entrypoint เพราะสคริปต์เป็น PID 1 ใน container — signal ที่ส่งจาก
# ใน container ถึง PID 1 ถูกทิ้ง (ลองแล้ว: timeout 2 วินาทีเป็น entrypoint → sleep 12 วินาทีรันครบ exit 0)
# คำสั่งลูกไม่ใช่ PID 1 จึงถูกหยุดได้จริง (busybox timeout: exec คำสั่งใน PID เดิม ส่ง signal ถึงตัวคำสั่งตรง ๆ)
bounded() {
  local remaining status=0
  remaining=$((deadline - $(date +%s)))
  if ((remaining <= 0)); then
    printf 'backup: ERROR: BACKUP_TIMEOUT_SECONDS=%s reached — not starting %s\n' "$timeout_seconds" "$1" >&2
    return 124
  fi
  timeout -s TERM -k 30 "$remaining" "$@" || status=$?
  if ((status != 0 && $(date +%s) >= deadline)); then
    printf 'backup: ERROR: %s stopped at BACKUP_TIMEOUT_SECONDS=%s\n' "$1" "$timeout_seconds" >&2
  fi
  return "$status"
}

# private network ของ Railway อาจยังไม่พร้อมทันทีที่ container เริ่ม — รอสูงสุด ~60 วินาที (ไม่เกินเส้นตาย)
# แล้วให้ pg_dump ฟ้องเอง
wait_for_database() {
  local attempt
  for attempt in $(seq 1 12); do
    pg_isready --dbname="$DATABASE_URL" --timeout=5 >/dev/null 2>&1 && return 0
    (($(date +%s) + 5 < deadline)) || break
    log "database not ready (attempt $attempt/12) — retrying in 5s"
    sleep 5
  done
  log "database still not ready — trying pg_dump anyway"
}

backup_database() {
  local stamp name dump dest listing prune old
  stamp=$(backup_stamp)
  name=$(backup_dump_name "$BACKUP_ENVIRONMENT" "$stamp")
  dump="$workdir/$name"
  dest="backup:$BACKUP_S3_BUCKET/$BACKUP_ENVIRONMENT/postgres"

  wait_for_database
  log "pg_dump ($(pg_dump --version)) → $name"
  # --lock-wait-timeout: ตารางถูกล็อก ACCESS EXCLUSIVE ค้าง (migration/คนถือ LOCK TABLE) = fail แทนรอไม่จบ
  bounded pg_dump --format=custom --no-password --lock-wait-timeout="$lock_wait" \
    --dbname="$DATABASE_URL" --file="$dump"
  [[ -s $dump ]] || fail "pg_dump produced an empty file"
  # อ่านทั้งไฟล์ (แปลงทุก entry เป็น SQL แล้วทิ้ง) — --list อ่านแค่ TOC ต้นไฟล์: dump ที่ขาดครึ่งก็ผ่าน
  bounded pg_restore --file=/dev/null "$dump"
  log "dump ok: $(wc -c <"$dump" | tr -d ' ') bytes"

  # copyto ตรวจ size + md5 หลังอัปโหลดเอง · --immutable: ชื่อซ้ำแต่เนื้อหาต่าง = fail ไม่เขียนทับ
  bounded rclone copyto "$dump" "$dest/$name" --immutable --retries 3 --log-level INFO --stats 0
  log "uploaded $dest/$name"

  # prune ต่อเมื่อเห็นไฟล์ที่เพิ่งอัปโหลดในรายชื่อจริงเท่านั้น (backup_prune_list ปฏิเสธถ้าไม่เห็น)
  listing=$(bounded rclone lsf --files-only "$dest/")
  prune=$(backup_prune_list "$BACKUP_ENVIRONMENT" "$keep_daily" "$keep_monthly" "$name" <<<"$listing")
  if [[ -z $prune ]]; then
    log "prune: nothing to delete"
  else
    while IFS= read -r old; do
      [[ -n $old && $old != "$name" ]] || continue
      log "prune: delete $old"
      bounded rclone deletefile "$dest/$old" --retries 3
    done <<<"$prune"
  fi
  log "database backup done: $name"
}

backup_files() {
  local src="media:$S3_BUCKET" dest="backup:$BACKUP_S3_BUCKET/$BACKUP_ENVIRONMENT/files"
  log "copy files $src → $dest (copy only — never deletes)"
  # --metadata: เก็บ content-type + x-amz-meta-* (sha256 ของ PDF) ไว้ตรวจความถูกต้องตอนกู้คืน
  # log เฉพาะ error + สรุปท้าย (จำนวนไฟล์ที่ copy/ตรวจ) — ไม่ไล่ชื่อไฟล์ทีละตัว
  bounded rclone copy "$src" "$dest" --immutable --metadata --retries 3 \
    --log-level NOTICE --stats 1h --stats-log-level NOTICE
  log "files backup done"
}

main() {
  require DATABASE_URL BACKUP_ENVIRONMENT \
    S3_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY \
    BACKUP_S3_ENDPOINT BACKUP_S3_REGION BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY
  backup_valid_env "$BACKUP_ENVIRONMENT" || fail "invalid BACKUP_ENVIRONMENT: '$BACKUP_ENVIRONMENT'"
  keep_daily=${BACKUP_KEEP_DAILY:-30}
  keep_monthly=${BACKUP_KEEP_MONTHLY:-12}
  [[ $keep_daily =~ ^[1-9][0-9]*$ ]] || fail "BACKUP_KEEP_DAILY must be an integer >= 1: '$keep_daily'"
  [[ $keep_monthly =~ ^(0|[1-9][0-9]*)$ ]] || fail "BACKUP_KEEP_MONTHLY must be an integer >= 0: '$keep_monthly'"
  # หน่วยบังคับ — ตัวเลขเปล่าใน Postgres = มิลลิวินาที (900 = 0.9 วินาที ไม่ใช่ 15 นาที)
  lock_wait=${BACKUP_LOCK_WAIT_TIMEOUT:-15min}
  [[ $lock_wait =~ ^[1-9][0-9]*(ms|s|min|h)$ ]] ||
    fail "BACKUP_LOCK_WAIT_TIMEOUT must be a number with a unit (ms|s|min|h), e.g. 15min: '$lock_wait'"
  # < 24 ชั่วโมง — รอบที่ยังไม่จบ Railway ข้ามรอบถัดไป
  timeout_seconds=${BACKUP_TIMEOUT_SECONDS:-21600}
  if ! [[ $timeout_seconds =~ ^[1-9][0-9]*$ ]] || ((timeout_seconds >= 86400)); then
    fail "BACKUP_TIMEOUT_SECONDS must be an integer from 1 to 86399: '$timeout_seconds'"
  fi
  command -v timeout >/dev/null || fail "timeout command not found — cannot bound the run"
  deadline=$(($(date +%s) + timeout_seconds))
  # ปลายทางต้องไม่ใช่ bucket ไฟล์เอง — สำเนาในที่เดียวกันไม่ใช่ backup
  if [[ ${S3_ENDPOINT%/} == "${BACKUP_S3_ENDPOINT%/}" && $S3_BUCKET == "$BACKUP_S3_BUCKET" ]]; then
    fail "backup destination is the files bucket itself ($S3_BUCKET) — refusing"
  fi

  # ไม่มี rclone.conf — remote มาจาก env ล้วน (ไม่ตั้ง = rclone เตือน "Config file not found" ทุกคำสั่ง)
  export RCLONE_CONFIG=/dev/null
  configure_remote MEDIA "${S3_PROVIDER:-Other}" "$S3_ENDPOINT" "$S3_REGION" \
    "$S3_ACCESS_KEY" "$S3_SECRET_KEY" "${S3_FORCE_PATH_STYLE:-false}"
  configure_remote BACKUP "${BACKUP_S3_PROVIDER:-Other}" "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_REGION" \
    "$BACKUP_S3_ACCESS_KEY" "$BACKUP_S3_SECRET_KEY" "${BACKUP_S3_FORCE_PATH_STYLE:-false}"

  workdir=$(mktemp -d)
  trap 'rm -rf "$workdir"' EXIT

  log "start environment=$BACKUP_ENVIRONMENT destination=$BACKUP_S3_BUCKET keep_daily=$keep_daily" \
    "keep_monthly=$keep_monthly lock_wait=$lock_wait timeout=${timeout_seconds}s"
  local db_status files_status
  # subshell + set -e ที่ไม่อยู่ใน if/||/&& — errexit ทำงานเต็มที่ข้างใน และส่วนหนึ่งพังไม่หยุดอีกส่วน
  set +e
  (
    set -e
    backup_database
  )
  db_status=$?
  (
    set -e
    backup_files
  )
  files_status=$?
  set -e

  if ((db_status != 0 || files_status != 0)); then
    printf 'backup: FAILED database=%s files=%s (exit codes)\n' "$db_status" "$files_status" >&2
    exit 1
  fi
  log "all done"
}

main "$@"

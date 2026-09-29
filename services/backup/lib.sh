# shellcheck shell=bash
# ฟังก์ชันของ backup.sh — แยกไว้ให้ backup.test.ts เรียกทีละตัวได้ (source อย่างเดียว ไม่รันอะไรเอง)
# เขียนให้ใช้ได้กับ bash 3.2 ของ macOS ด้วย (ไม่มี associative array / mapfile) — เทสต์รันบนเครื่อง dev ได้

# ชื่อ environment ใช้ทั้งใน prefix และชื่อไฟล์ — ตัวเล็ก ตัวเลข ขีด (ไม่ขึ้นต้น/ลงท้ายด้วยขีด)
backup_valid_env() {
  [[ $1 =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]
}

# เวลาปัจจุบันแบบ UTC — ความยาวคงที่ เรียงตามตัวอักษร = เรียงตามเวลา
backup_stamp() {
  date -u +%Y%m%dT%H%M%SZ
}

# backup_dump_name ENV STAMP → ENV-YYYYMMDDTHHMMSSZ.dump
backup_dump_name() {
  local env=$1 stamp=$2
  if ! backup_valid_env "$env"; then
    echo "invalid environment name: '$env'" >&2
    return 1
  fi
  if ! [[ $stamp =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
    echo "invalid UTC timestamp: '$stamp'" >&2
    return 1
  fi
  printf '%s-%s.dump\n' "$env" "$stamp"
}

# backup_prune_list ENV KEEP_DAILY KEEP_MONTHLY JUST_UPLOADED < รายชื่อไฟล์ใน prefix (หนึ่งชื่อต่อบรรทัด)
# พิมพ์ชื่อที่ต้องลบ — เก็บ:
#   - ทุก dump ของ KEEP_DAILY วัน (UTC) ล่าสุดที่มี dump (นับวันที่มีไฟล์ ไม่ใช่วันตามปฏิทิน —
#     cron หยุดไปหลายวัน ของเก่าก็ไม่หายเพราะอายุ) · วันเดียวกันหลายไฟล์เก็บหมด: รันมือหลังข้อมูลเสีย
#     ต้องไม่ลบ dump ดีของคืนนั้น
#   - dump ล่าสุดของแต่ละเดือน KEEP_MONTHLY เดือนล่าสุดที่มี dump (รวมเดือนปัจจุบัน)
#   - JUST_UPLOADED เสมอ
# ไม่แตะชื่อที่ไม่ตรงรูป ENV-YYYYMMDDTHHMMSSZ.dump (ไฟล์อื่น/environment อื่น = ไม่ลบ)
# fail-closed: argument ผิด หรือ JUST_UPLOADED ไม่อยู่ในรายชื่อ (ยืนยันการอัปโหลดไม่ได้) = return 1 ไม่พิมพ์อะไร
backup_prune_list() {
  local env=$1 daily=$2 monthly=$3 keep=$4 names
  if ! backup_valid_env "$env"; then
    echo "invalid environment name: '$env'" >&2
    return 1
  fi
  if ! [[ $daily =~ ^[1-9][0-9]*$ ]]; then
    echo "BACKUP_KEEP_DAILY must be an integer >= 1: '$daily'" >&2
    return 1
  fi
  if ! [[ $monthly =~ ^(0|[1-9][0-9]*)$ ]]; then
    echo "BACKUP_KEEP_MONTHLY must be an integer >= 0: '$monthly'" >&2
    return 1
  fi
  names=$(cat)
  if [[ -z $keep ]] || ! grep -qxF -- "$keep" <<<"$names"; then
    echo "just-uploaded dump '$keep' is not in the listing — refusing to prune" >&2
    return 1
  fi
  # ใหม่ → เก่า: วันที่เจอก่อน = วันล่าสุด · ตัวแรกที่เจอของแต่ละเดือน = ตัวล่าสุดของเดือนนั้น
  printf '%s\n' "$names" | LC_ALL=C sort -r -u | awk -v env="$env" -v daily="$daily" -v monthly="$monthly" -v keep="$keep" '
    {
      name = $0
      if (index(name, env "-") != 1) next
      stamp = substr(name, length(env) + 2)
      if (stamp !~ /^[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z\.dump$/) next
      day = substr(stamp, 1, 8)
      month = substr(stamp, 1, 6)
      kept = (name == keep)
      if (!(day in seen_day)) {
        seen_day[day] = 1
        if (days < daily + 0) { days++; keep_day[day] = 1 }
      }
      if (day in keep_day) kept = 1
      if (!(month in seen_month)) {
        seen_month[month] = 1
        if (months < monthly + 0) { months++; kept = 1 }
      }
      if (!kept) print name
    }
  '
}

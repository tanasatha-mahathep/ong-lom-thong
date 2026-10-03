import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const LIB = join(import.meta.dirname, "lib.sh");
const SCRIPT = join(import.meta.dirname, "backup.sh");

type Result = { status: number | null; stdout: string; stderr: string };

/** เรียกฟังก์ชันใน lib.sh ด้วย argument ตรง ๆ (ไม่ผ่านการต่อสตริง shell) */
function lib(fn: string, args: string[], input = ""): Result {
  const r = spawnSync("bash", ["-c", `. "$0"; ${fn} "$@"`, LIB, ...args], { input, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const lines = (s: string) => s.split("\n").filter(Boolean);

/**
 * macOS ไม่มี timeout (coreutils) — จำลองด้วย perl alarm (SIGALRM ถึงตัวคำสั่งเมื่อครบเวลา) ให้เทสต์รันบนเครื่อง dev ได้
 * BACKUP_TEST_TIMEOUT_SHIM=1 บังคับใช้ตัวจำลองบน Linux เพื่อตรวจตัวจำลองเอง
 */
const HOST_HAS_TIMEOUT =
  !process.env.BACKUP_TEST_TIMEOUT_SHIM && spawnSync("sh", ["-c", "command -v timeout"]).status === 0;
const TIMEOUT_SHIM = `while [[ $1 == -* ]]; do case $1 in -s | -k) shift 2 ;; *) shift ;; esac; done
secs=$1; shift
exec perl -e 'alarm shift @ARGV; exec @ARGV or die "exec: $!\\n"' "$secs" "$@"`;

/**
 * งบของเทสต์ "ค้าง" = งบทั้งรอบ (ทุกขั้นฐานข้อมูลกับไฟล์ใช้ร่วมกัน) และ date +%s ตัดเศษวินาที
 * → งบ 2–3 วินาทีเหลือจริงแค่ราว 1–2 วินาที ใต้โหลดสูงขั้นปกติกินงบหมดก่อนถึงคำสั่งที่ค้างจริง → เทสต์ล้มสลับกัน
 * 10 วินาที: ขั้นปกติจบในงบ และ sleep 60 ยังถูกฆ่าราว 10 วินาที (เทสต์ยืนยันด้วย elapsed < 20 วินาที)
 */
const HANG_BUDGET_SECONDS = "10";

/** dump รายวันเวลา 19:17 UTC (= 02:17 น. เวลาไทย) ย้อนหลังจากวันที่ให้ */
function dailyNames(env: string, newest: Date, days: number): string[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(newest.getTime() - i * 86_400_000);
    return `${env}-${stamp(d)}.dump`;
  });
}
function stamp(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

describe("backup_dump_name — ชื่อไฟล์ dump", () => {
  it("environment + เวลา UTC", () => {
    const r = lib("backup_dump_name", ["production", "20260929T191700Z"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("production-20260929T191700Z.dump\n");
  });

  it.each(["", "Production", "-dev", "dev-", "a/b", "dev x", "../x"])("environment ผิดรูป %j = ปฏิเสธ", (env) => {
    const r = lib("backup_dump_name", [env, "20260929T191700Z"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
  });

  it.each(["", "2026-09-29", "20260929T1917Z", "20260929T191700", "20260929T191700Z/x"])(
    "เวลาผิดรูป %j = ปฏิเสธ",
    (s) => {
      expect(lib("backup_dump_name", ["dev", s]).status).toBe(1);
    },
  );

  it("backup_stamp เป็น UTC ความยาวคงที่ (เรียงตามตัวอักษร = เรียงตามเวลา)", () => {
    const r = lib("backup_stamp", []);
    expect(r.stdout.trim()).toMatch(/^\d{8}T\d{6}Z$/);
  });
});

describe("backup_prune_list — เลือก dump ที่จะลบ", () => {
  const prune = (names: string[], daily: string, monthly: string, keep: string, env = "p") =>
    lib("backup_prune_list", [env, daily, monthly, keep], names.join("\n") + "\n");

  it("เก็บทุกไฟล์ของ N วันล่าสุด + ล่าสุดของแต่ละเดือน M เดือน · ไม่แตะไฟล์อื่น", () => {
    const names = [
      "p-20260929T191700Z.dump", // วันที่ 1 + เดือน ก.ย.
      "p-20260928T191700Z.dump", // วันที่ 2 (รันมือหลังข้อมูลเสีย?)
      "p-20260928T081000Z.dump", // วันที่ 2 เหมือนกัน — dump ก่อนหน้าของวันต้องอยู่
      "p-20260927T191700Z.dump", // วันที่ 3
      "p-20260926T191700Z.dump", // เกิน 3 วัน → ลบ
      "p-20260926T020000Z.dump", // → ลบ
      "p-20260831T191700Z.dump", // เดือน ส.ค. (ล่าสุดของเดือน)
      "p-20260830T191700Z.dump", // → ลบ
      "p-20260731T191700Z.dump", // เกิน 2 เดือน → ลบ
      // ไม่ตรงรูป / environment อื่น — ห้ามลบเด็ดขาด
      "notes.txt",
      "staging-20200101T000000Z.dump",
      "p-x-20200101T000000Z.dump",
      "p-20200101T000000Z.dump.partial",
      "p-2020.dump",
    ];
    const r = prune(names, "3", "2", "p-20260929T191700Z.dump");
    expect(r.status).toBe(0);
    expect(lines(r.stdout)).toEqual([
      "p-20260926T191700Z.dump",
      "p-20260926T020000Z.dump",
      "p-20260830T191700Z.dump",
      "p-20260731T191700Z.dump",
    ]);
  });

  it("400 คืน (30 วัน + 12 เดือน): เก็บ 30 ล่าสุด + ล่าสุดของ 12 เดือน · ที่เหลือลบ", () => {
    const names = dailyNames("production", new Date("2026-09-29T19:17:00Z"), 400);
    const newest = names[0]!;
    const r = prune(names, "30", "12", newest, "production");
    expect(r.status).toBe(0);
    const deleted = new Set(lines(r.stdout));
    const kept = names.filter((n) => !deleted.has(n));

    // 30 ล่าสุดอยู่ครบ
    expect(kept.slice(0, 30)).toEqual(names.slice(0, 30));
    // ล่าสุดของแต่ละเดือน 12 เดือนล่าสุด (ต.ค. 2568 – ก.ย. 2569) อยู่ครบ
    const months = [...new Set(names.map((n) => n.slice(11, 17)))].slice(0, 12);
    for (const m of months) {
      expect(kept.find((n) => n.slice(11, 17) === m)).toBe(names.find((n) => n.slice(11, 17) === m));
    }
    // เก่ากว่านั้นลบหมด · จำนวนที่เก็บ = 30 วัน + เดือนที่ไม่อยู่ใน 30 วันนั้น
    const monthlyOutside30 = months.filter((m) => !names.slice(0, 30).some((n) => n.slice(11, 17) === m)).length;
    expect(kept).toHaveLength(30 + monthlyOutside30);
    expect(deleted.size).toBe(400 - kept.length);
  });

  it("ไฟล์ที่เพิ่งอัปโหลดไม่ถูกลบ แม้ชื่อจะเก่ากว่าช่วงที่เก็บ (นาฬิกาเพี้ยน)", () => {
    const names = dailyNames("p", new Date("2026-09-29T19:17:00Z"), 60);
    const old = names[45]!;
    const r = prune(names, "7", "0", old);
    expect(r.status).toBe(0);
    expect(lines(r.stdout)).not.toContain(old);
    expect(lines(r.stdout)).toHaveLength(60 - 7 - 1);
  });

  it("KEEP_MONTHLY = 0 → เก็บเฉพาะรายวัน", () => {
    const names = dailyNames("p", new Date("2026-09-29T19:17:00Z"), 10);
    const r = prune(names, "4", "0", names[0]!);
    expect(lines(r.stdout)).toEqual(names.slice(4));
  });

  it("fail-closed: ไม่เห็นไฟล์ที่เพิ่งอัปโหลดในรายชื่อ = ไม่ลบอะไร", () => {
    const names = dailyNames("p", new Date("2026-09-29T19:17:00Z"), 60);
    const r = prune(names, "3", "1", "p-20270101T000000Z.dump");
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/refusing to prune/);
  });

  it("fail-closed: รายชื่อว่าง / ไม่ระบุไฟล์ที่เพิ่งอัปโหลด = ไม่ลบอะไร", () => {
    expect(prune([], "3", "1", "p-20260929T191700Z.dump").status).toBe(1);
    const names = dailyNames("p", new Date("2026-09-29T19:17:00Z"), 10);
    const r = prune(names, "3", "1", "");
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
  });

  it.each([
    ["0", "12"],
    ["-1", "12"],
    ["abc", "12"],
    ["", "12"],
    ["30", "-1"],
    ["30", "x"],
    ["30", ""],
  ])("จำนวนที่เก็บผิด (daily %j monthly %j) = ปฏิเสธ ไม่ลบอะไร", (daily, monthly) => {
    const names = dailyNames("p", new Date("2026-09-29T19:17:00Z"), 60);
    const r = prune(names, daily, monthly, names[0]!);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
  });
});

describe("backup_size_guard — dump เล็กลงผิดปกติ = ห้าม prune", () => {
  const guard = (rows: [string, number][], keep: string, doomed: string[] = [], percent = "50", env = "p") =>
    lib(
      "backup_size_guard",
      [env, percent, keep, doomed.join("\n")],
      rows.map(([n, s]) => `${n}\t${s}`).join("\n") + "\n",
    );
  const NEW = "p-20260929T191700Z.dump";
  const PREV = "p-20260928T191700Z.dump";

  it("ข้อมูลโตขึ้นตามปกติ → ผ่าน", () => {
    const r = guard(
      [
        ["p-20260801T191700Z.dump", 900],
        [PREV, 990],
        [NEW, 1000],
      ],
      NEW,
      ["p-20260801T191700Z.dump"],
    );
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("ลดลงแต่ยัง ≥ 50% ของ dump ก่อนหน้า → ผ่าน", () => {
    expect(
      guard(
        [
          [PREV, 1000],
          [NEW, 500],
        ],
        NEW,
      ).status,
    ).toBe(0);
  });

  it("คืนแรกหลัง database ถูกล้าง: < 50% ของ dump ก่อนหน้า → ไม่ผ่าน แม้ไม่มีอะไรจะลบ", () => {
    const r = guard(
      [
        [PREV, 1000],
        [NEW, 499],
      ],
      NEW,
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(`${NEW} is 499 bytes, less than 50% of the previous dump ${PREV} (1000 bytes)`);
  });

  it("30 คืนต่อมา: dump ก่อนเกิดเหตุที่ถึงคิวลบใหญ่กว่า 2 เท่า → ไม่ผ่าน (dump ก่อนหน้าเล็กเหมือนกันแล้ว)", () => {
    const before = "p-20260829T191700Z.dump";
    const r = guard(
      [
        [before, 1000],
        ["p-20260830T191700Z.dump", 400],
        [PREV, 400],
        [NEW, 410],
      ],
      NEW,
      [before],
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(`refusing to delete ${before} (1000 bytes): ${NEW} (410 bytes) is less than 50% of it`);
    expect(r.stderr).not.toMatch(/previous dump/);
  });

  it("ไม่นับไฟล์ที่ไม่ใช่ dump ของ environment นี้ (ใหญ่แค่ไหนก็ไม่เกี่ยว)", () => {
    const r = guard(
      [
        ["notes.txt", 999_999],
        ["staging-20260928T191700Z.dump", 999_999],
        ["p-20260928T191700Z.dump.partial", 999_999],
        [PREV, 1000],
        [NEW, 1000],
      ],
      NEW,
      ["notes.txt", "staging-20260928T191700Z.dump"],
    );
    expect(r.status).toBe(0);
  });

  it("ขนาดระดับ GB คำนวณไม่ล้น", () => {
    const rows = (n: number): [string, number][] => [
      [PREV, 6_000_000_000],
      [NEW, n],
    ];
    expect(guard(rows(5_000_000_000), NEW).status).toBe(0);
    const r = guard(rows(2_000_000_000), NEW);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch("is 2000000000 bytes, less than 50% of the previous dump");
    expect(r.stderr).toMatch("(6000000000 bytes)");
  });

  it("BACKUP_MIN_SIZE_PERCENT = 0 → ปิดการตรวจ", () => {
    const r = guard(
      [
        [PREV, 1000],
        [NEW, 1],
      ],
      NEW,
      [PREV],
      "0",
    );
    expect(r.status).toBe(0);
  });

  it("fail-closed: ไม่เห็นไฟล์ที่เพิ่งอัปโหลดในรายชื่อ → ไม่ผ่าน", () => {
    const r = guard([[PREV, 1000]], NEW);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not in the listing/);
  });

  it.each(["-1", "101", "half", "", "5.5"])("MIN_PERCENT ผิด %j → ไม่ผ่าน", (percent) => {
    const r = guard(
      [
        [PREV, 1000],
        [NEW, 1000],
      ],
      NEW,
      [],
      percent,
    );
    expect(r.status).toBe(1);
  });
});

/**
 * backup.sh ทั้งตัวกับ pg_dump / pg_restore / pg_isready / rclone ปลอมใน PATH
 * ตรวจลำดับและเงื่อนไข (prune หลังอัปโหลดสำเร็จเท่านั้น · copy ไม่ใช่ sync · ค่าลับไม่อยู่ใน argv)
 * end-to-end จริงกับ Postgres + S3: .railway/README.md หัวข้อ "ทดสอบบนเครื่อง"
 */
describe("backup.sh — ลำดับงานและ fail-closed", () => {
  let dir: string;
  let state: string;
  let bin: string;

  const SECRETS = {
    S3_SECRET_KEY: "media-secret-0123456789abcdef",
    BACKUP_S3_SECRET_KEY: "backup-secret-fedcba9876543210",
  };
  const baseEnv = () => ({
    DATABASE_URL: "postgresql://ong:db-password-xyz@postgres.railway.internal:5432/railway",
    BACKUP_ENVIRONMENT: "staging",
    BACKUP_KEEP_DAILY: "30",
    BACKUP_KEEP_MONTHLY: "12",
    S3_ENDPOINT: "https://storage.railway.app",
    S3_REGION: "auto",
    S3_BUCKET: "media-abc123",
    S3_ACCESS_KEY: "media-key",
    S3_FORCE_PATH_STYLE: "false",
    BACKUP_S3_ENDPOINT: "https://storage.railway.app",
    BACKUP_S3_REGION: "auto",
    BACKUP_S3_BUCKET: "backup-def456",
    BACKUP_S3_ACCESS_KEY: "backup-key",
    BACKUP_S3_FORCE_PATH_STYLE: "false",
    ...SECRETS,
  });

  function stub(name: string, body: string) {
    const file = join(bin, name);
    writeFileSync(file, `#!/usr/bin/env bash\nset -u\n${body}\n`);
    chmodSync(file, 0o755);
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ong-backup-test-"));
    state = join(dir, "state");
    bin = join(dir, "bin");
    spawnSync("mkdir", ["-p", state, bin]);
    writeFileSync(join(state, "remote.txt"), "");
    stub(
      "pg_dump",
      `echo "$*" >> "$STUB_STATE/pg_dump.log"
[[ \${1:-} == --version ]] && { echo "pg_dump (PostgreSQL) 18.6"; exit 0; }
[[ -n \${STUB_HANG_PGDUMP:-} ]] && exec sleep 60
[[ -n \${STUB_FAIL_PGDUMP:-} ]] && { echo "pg_dump: error: connection refused" >&2; exit 1; }
for a in "$@"; do case "$a" in --file=*) printf 'PGDMP-stub' > "\${a#--file=}";; esac; done`,
    );
    stub(
      "pg_restore",
      `echo "$*" >> "$STUB_STATE/pg_restore.log"
[[ -n \${STUB_FAIL_RESTORE:-} ]] && { echo "pg_restore: error: could not read from input file: end of file" >&2; exit 1; }
exit 0`,
    );
    stub("pg_isready", "exit 0");
    stub(
      "rclone",
      `echo "$*" >> "$STUB_STATE/rclone.log"
env | grep '^RCLONE_CONFIG_' | LC_ALL=C sort > "$STUB_STATE/rclone.env"
case "$1" in
  copyto)
    [[ -n \${STUB_FAIL_UPLOAD:-} ]] && { echo "upload failed" >&2; exit 1; }
    [[ -n \${STUB_HIDE_UPLOAD:-} ]] ||
      printf '%s\\t%s\\n' "$(basename "$3")" "$(wc -c < "$2" | tr -d ' ')" >> "$STUB_STATE/remote.txt" ;;
  lsf)
    # ปลายทางปลอม: บรรทัดละ "ชื่อ<TAB>ขนาด" — --format ps ได้ทั้งสองช่อง ไม่งั้นได้แค่ชื่อ
    if [[ " $* " == *" --format ps "* ]]; then cat "$STUB_STATE/remote.txt"; else cut -f1 "$STUB_STATE/remote.txt"; fi ;;
  deletefile)
    n=$(basename "$2"); echo "$n" >> "$STUB_STATE/deleted.txt"
    awk -F '\\t' -v n="$n" '$1 != n' "$STUB_STATE/remote.txt" > "$STUB_STATE/remote.tmp"
    mv "$STUB_STATE/remote.tmp" "$STUB_STATE/remote.txt" ;;
  copy)
    [[ -n \${STUB_HANG_COPY:-} ]] && exec sleep 60
    [[ -n \${STUB_FAIL_COPY:-} ]] && { echo "copy failed" >&2; exit 1; }; exit 0 ;;
  *) echo "unexpected rclone command: $1" >&2; exit 2 ;;
esac`,
    );
    if (!HOST_HAS_TIMEOUT) stub("timeout", TIMEOUT_SHIM);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function run(env: Record<string, string>): Result {
    // env สะอาด — ไม่รับ S3_* / DATABASE_URL จาก shell ของคนรันเทสต์
    const r = spawnSync("bash", [SCRIPT], {
      env: { PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: dir, TMPDIR: dir, STUB_STATE: state, ...env },
      encoding: "utf8",
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }
  const read = (name: string) => (existsSync(join(state, name)) ? readFileSync(join(state, name), "utf8") : "");
  const rcloneCalls = () => lines(read("rclone.log"));
  /** dump ปลอมของ stub pg_dump ยาว 10 ไบต์ ('PGDMP-stub') — ค่าเริ่มต้นให้ dump เก่าขนาดเท่ากัน */
  const seedRemote = (names: string[], size = 10) =>
    writeFileSync(join(state, "remote.txt"), names.map((n) => `${n}\t${size}`).join("\n") + "\n");
  const remoteNames = () => lines(read("remote.txt")).map((l) => l.split("\t")[0]!);

  it("สำเร็จ: dump → ตรวจ → อัปโหลด → prune (เก่ากว่าช่วงเก็บ) → copy ไฟล์", () => {
    // dump เก่า 60 คืนก่อนวันนี้ — คืนนี้เพิ่มอีกหนึ่ง
    const old = dailyNames("staging", new Date(Date.now() - 86_400_000), 60);
    seedRemote(old);
    const r = run(baseEnv());
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/all done — database: ok \(staging-\d{8}T\d{6}Z\.dump\) · files: ok$/m);

    const pgDump = lines(read("pg_dump.log")).find((l) => l.includes("--format=custom"));
    expect(pgDump).toBeDefined();

    const calls = rcloneCalls();
    const upload = calls.find((c) => c.startsWith("copyto "));
    expect(upload).toMatch(/ backup:backup-def456\/staging\/postgres\/staging-\d{8}T\d{6}Z\.dump /);
    expect(upload).toContain("--immutable");
    const uploaded = upload!.match(/(staging-\d{8}T\d{6}Z\.dump)/)![1]!;

    // prune หลัง upload และไม่ลบไฟล์ที่เพิ่งอัปโหลด
    const deleted = lines(read("deleted.txt"));
    expect(deleted.length).toBeGreaterThan(0);
    expect(deleted).not.toContain(uploaded);
    expect(calls.findIndex((c) => c.startsWith("deletefile"))).toBeGreaterThan(calls.indexOf(upload!));
    const remaining = remoteNames();
    expect(remaining).toContain(uploaded);
    expect(remaining.length).toBeGreaterThanOrEqual(30);
    expect(remaining.length).toBeLessThanOrEqual(30 + 12);

    // ไฟล์: copy เท่านั้น (ไม่มี sync/move/purge/delete) · immutable · เก็บ metadata
    const copy = calls.find((c) => c.startsWith("copy "));
    expect(copy).toMatch(/^copy media:media-abc123 backup:backup-def456\/staging\/files /);
    expect(copy).toContain("--immutable");
    expect(copy).toContain("--metadata");
    expect(calls.filter((c) => /^(sync|move|moveto|purge|delete|rmdir|rmdirs|cleanup|bisync) /.test(c))).toEqual([]);
  });

  it("ค่าลับไม่ผ่าน argv — rclone ได้จาก env (RCLONE_CONFIG_*) ไม่มี rclone.conf", () => {
    const r = run(baseEnv());
    expect(r.status).toBe(0);
    const argv = read("rclone.log") + read("pg_dump.log").replace(/--dbname=\S+/g, "");
    for (const s of Object.values(SECRETS)) expect(argv).not.toContain(s);
    const env = read("rclone.env");
    expect(env).toContain(`RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY=${SECRETS.BACKUP_S3_SECRET_KEY}`);
    expect(env).toContain(`RCLONE_CONFIG_MEDIA_SECRET_ACCESS_KEY=${SECRETS.S3_SECRET_KEY}`);
    expect(env).toContain("RCLONE_CONFIG_BACKUP_TYPE=s3");
    expect(env).toContain("RCLONE_CONFIG_BACKUP_PROVIDER=Other");
    expect(env).toContain("RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET=true");
    expect(env).toContain("RCLONE_CONFIG_MEDIA_FORCE_PATH_STYLE=false");
  });

  it("อัปโหลดไม่สำเร็จ → ไม่ prune · ไฟล์ยัง copy · exit ≠ 0", () => {
    seedRemote(dailyNames("staging", new Date(Date.now() - 86_400_000), 60));
    const r = run({ ...baseEnv(), STUB_FAIL_UPLOAD: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/backup: FAILED — database: FAILED \(exit 1\) · files: ok$/m);
    const calls = rcloneCalls();
    expect(calls.some((c) => c.startsWith("deletefile") || c.startsWith("lsf"))).toBe(false);
    expect(read("deleted.txt")).toBe("");
    expect(calls.some((c) => c.startsWith("copy "))).toBe(true);
  });

  it("อัปโหลด 'สำเร็จ' แต่ไม่เห็นไฟล์ในปลายทาง → ไม่ prune · exit ≠ 0", () => {
    seedRemote(dailyNames("staging", new Date(Date.now() - 86_400_000), 60));
    const r = run({ ...baseEnv(), STUB_HIDE_UPLOAD: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/refusing to prune/);
    expect(read("deleted.txt")).toBe("");
  });

  it("pg_dump พัง → ไม่อัปโหลด ไม่ prune · ไฟล์ยัง copy · exit ≠ 0", () => {
    seedRemote(dailyNames("staging", new Date(Date.now() - 86_400_000), 60));
    const r = run({ ...baseEnv(), STUB_FAIL_PGDUMP: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/connection refused/);
    const calls = rcloneCalls();
    expect(calls.some((c) => /^(copyto|lsf|deletefile) /.test(c))).toBe(false);
    expect(calls.some((c) => c.startsWith("copy "))).toBe(true);
  });

  it("ตรวจ dump ด้วยการอ่านทั้งไฟล์ ไม่ใช่แค่ TOC (--list ผ่านแม้ไฟล์ขาดครึ่ง)", () => {
    const r = run(baseEnv());
    expect(r.status).toBe(0);
    const restore = lines(read("pg_restore.log"));
    expect(restore).toHaveLength(1);
    expect(restore[0]).toMatch(/^--file=\/dev\/null \S+\/staging-\d{8}T\d{6}Z\.dump$/);
  });

  it("dump อ่านกลับไม่ครบ (pg_restore พัง) → ไม่อัปโหลด · exit ≠ 0", () => {
    const r = run({ ...baseEnv(), STUB_FAIL_RESTORE: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/end of file/);
    expect(rcloneCalls().some((c) => c.startsWith("copyto"))).toBe(false);
  });

  it("copy ไฟล์พัง → database ยังสำรองครบ และบรรทัดสรุปบอกผลของ database ด้วย · exit ≠ 0", () => {
    const r = run({ ...baseEnv(), STUB_FAIL_COPY: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/database backup done/);
    expect(r.stderr).toMatch(
      /files copy failed \(exit 1\) — for "immutable file modified" see .*ไฟล์ใน Media ถูกเขียนทับ/,
    );
    expect(r.stderr).toMatch(
      /backup: FAILED — database: ok \(staging-\d{8}T\d{6}Z\.dump\) · files: FAILED \(exit 1\)$/m,
    );
  });

  it("ขาดตัวแปร → หยุดก่อนทำอะไร พร้อมรายชื่อที่ขาด", () => {
    const env: Record<string, string> = baseEnv();
    delete env.DATABASE_URL;
    delete env.BACKUP_S3_BUCKET;
    const r = run(env);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/missing required variables: DATABASE_URL BACKUP_S3_BUCKET/);
    expect(read("pg_dump.log")).toBe("");
    expect(rcloneCalls()).toEqual([]);
  });

  it("ปลายทางเป็น bucket ไฟล์เอง → ปฏิเสธ", () => {
    const r = run({
      ...baseEnv(),
      BACKUP_S3_BUCKET: "media-abc123",
      BACKUP_S3_ENDPOINT: "https://storage.railway.app/",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refusing/);
    expect(rcloneCalls()).toEqual([]);
  });

  it.each([
    ["BACKUP_KEEP_DAILY", "0"],
    ["BACKUP_KEEP_DAILY", "thirty"],
    ["BACKUP_KEEP_MONTHLY", "-1"],
    ["BACKUP_ENVIRONMENT", "Staging"],
    // ตัวเลขเปล่าใน Postgres = มิลลิวินาที — บังคับใส่หน่วย
    ["BACKUP_LOCK_WAIT_TIMEOUT", "900"],
    ["BACKUP_LOCK_WAIT_TIMEOUT", "15 minutes"],
    ["BACKUP_LOCK_WAIT_TIMEOUT", "0s"],
    ["BACKUP_TIMEOUT_SECONDS", "0"],
    ["BACKUP_TIMEOUT_SECONDS", "86400"],
    ["BACKUP_TIMEOUT_SECONDS", "6h"],
    ["BACKUP_MIN_SIZE_PERCENT", "101"],
    ["BACKUP_MIN_SIZE_PERCENT", "-5"],
    ["BACKUP_MIN_SIZE_PERCENT", "half"],
  ])("%s=%j ผิด → หยุดก่อนทำอะไร", (key, value) => {
    const r = run({ ...baseEnv(), [key]: value });
    expect(r.status).toBe(1);
    expect(rcloneCalls()).toEqual([]);
    expect(read("pg_dump.log")).toBe("");
  });

  it("dump ใหม่เล็กลงมาก (database ถูกล้าง?) → เก็บ dump ใหม่ไว้ แต่ไม่ prune · ไฟล์ยัง copy · exit ≠ 0", () => {
    // dump เก่า 1000 ไบต์ · dump คืนนี้ 10 ไบต์
    seedRemote(dailyNames("staging", new Date(Date.now() - 86_400_000), 60), 1000);
    const r = run(baseEnv());
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/size guard: staging-\d{8}T\d{6}Z\.dump is 10 bytes, less than 50% of the previous dump/);
    expect(r.stderr).toMatch(/dump size check failed — nothing pruned/);
    expect(read("deleted.txt")).toBe("");
    expect(remoteNames()).toHaveLength(61);
    const lsf = rcloneCalls().find((c) => c.startsWith("lsf "));
    expect(lsf).toMatch(/--format ps --separator\s/);
    expect(rcloneCalls().some((c) => c.startsWith("copy "))).toBe(true);
  });

  it("BACKUP_MIN_SIZE_PERCENT=0 → ปิดการตรวจขนาด (prune ตามปกติ)", () => {
    seedRemote(dailyNames("staging", new Date(Date.now() - 86_400_000), 60), 1000);
    const r = run({ ...baseEnv(), BACKUP_MIN_SIZE_PERCENT: "0" });
    expect(r.status).toBe(0);
    expect(lines(read("deleted.txt")).length).toBeGreaterThan(0);
  });

  it("pg_dump รอ lock ได้ไม่เกิน BACKUP_LOCK_WAIT_TIMEOUT (ค่าเริ่มต้น 15min)", () => {
    expect(run(baseEnv()).status).toBe(0);
    const dump = () => lines(read("pg_dump.log")).filter((l) => l.includes("--format=custom"));
    expect(dump()).toHaveLength(1);
    expect(dump()[0]).toContain("--lock-wait-timeout=15min");

    writeFileSync(join(state, "pg_dump.log"), "");
    expect(run({ ...baseEnv(), BACKUP_LOCK_WAIT_TIMEOUT: "90s" }).status).toBe(0);
    expect(dump()[0]).toContain("--lock-wait-timeout=90s");
  });

  it("pg_dump ค้าง → หยุดที่เส้นตายของรอบ · ไม่อัปโหลด · copy ไฟล์ไม่เริ่ม · exit ≠ 0", () => {
    const started = Date.now();
    const r = run({ ...baseEnv(), BACKUP_TIMEOUT_SECONDS: HANG_BUDGET_SECONDS, STUB_HANG_PGDUMP: "1" });
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(`pg_dump stopped at BACKUP_TIMEOUT_SECONDS=${HANG_BUDGET_SECONDS}`);
    expect(r.stderr).toMatch(`BACKUP_TIMEOUT_SECONDS=${HANG_BUDGET_SECONDS} reached — not starting rclone`);
    expect(rcloneCalls()).toEqual([]);
  }, 30_000);

  it("rclone ค้าง → หยุดที่เส้นตายของรอบ · database ที่สำรองแล้วยังอยู่ · exit ≠ 0", () => {
    const started = Date.now();
    const r = run({ ...baseEnv(), BACKUP_TIMEOUT_SECONDS: HANG_BUDGET_SECONDS, STUB_HANG_COPY: "1" });
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/database backup done/);
    expect(r.stderr).toMatch(`rclone stopped at BACKUP_TIMEOUT_SECONDS=${HANG_BUDGET_SECONDS}`);
    expect(remoteNames().some((n) => /^staging-\d{8}T\d{6}Z\.dump$/.test(n))).toBe(true);
  }, 30_000);
});

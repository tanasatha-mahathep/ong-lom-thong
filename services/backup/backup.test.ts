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
[[ -n \${STUB_FAIL_PGDUMP:-} ]] && { echo "pg_dump: error: connection refused" >&2; exit 1; }
for a in "$@"; do case "$a" in --file=*) printf 'PGDMP-stub' > "\${a#--file=}";; esac; done`,
    );
    stub(
      "pg_restore",
      `[[ -n \${STUB_FAIL_RESTORE:-} ]] && { echo "pg_restore: error: truncated" >&2; exit 1; }; exit 0`,
    );
    stub("pg_isready", "exit 0");
    stub(
      "rclone",
      `echo "$*" >> "$STUB_STATE/rclone.log"
env | grep '^RCLONE_CONFIG_' | LC_ALL=C sort > "$STUB_STATE/rclone.env"
case "$1" in
  copyto)
    [[ -n \${STUB_FAIL_UPLOAD:-} ]] && { echo "upload failed" >&2; exit 1; }
    [[ -n \${STUB_HIDE_UPLOAD:-} ]] || basename "$3" >> "$STUB_STATE/remote.txt" ;;
  lsf) cat "$STUB_STATE/remote.txt" ;;
  deletefile)
    n=$(basename "$2"); echo "$n" >> "$STUB_STATE/deleted.txt"
    grep -vxF "$n" "$STUB_STATE/remote.txt" > "$STUB_STATE/remote.tmp" || true
    mv "$STUB_STATE/remote.tmp" "$STUB_STATE/remote.txt" ;;
  copy) [[ -n \${STUB_FAIL_COPY:-} ]] && { echo "copy failed" >&2; exit 1; }; exit 0 ;;
  *) echo "unexpected rclone command: $1" >&2; exit 2 ;;
esac`,
    );
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
  const seedRemote = (names: string[]) => writeFileSync(join(state, "remote.txt"), names.join("\n") + "\n");

  it("สำเร็จ: dump → ตรวจ → อัปโหลด → prune (เก่ากว่าช่วงเก็บ) → copy ไฟล์", () => {
    // dump เก่า 60 คืนก่อนวันนี้ — คืนนี้เพิ่มอีกหนึ่ง
    const old = dailyNames("staging", new Date(Date.now() - 86_400_000), 60);
    seedRemote(old);
    const r = run(baseEnv());
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/all done/);

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
    const remaining = lines(read("remote.txt"));
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
    expect(r.stderr).toMatch(/FAILED database=1 files=0/);
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

  it("dump อ่านกลับไม่ได้ (pg_restore --list พัง) → ไม่อัปโหลด · exit ≠ 0", () => {
    const r = run({ ...baseEnv(), STUB_FAIL_RESTORE: "1" });
    expect(r.status).not.toBe(0);
    expect(rcloneCalls().some((c) => c.startsWith("copyto"))).toBe(false);
  });

  it("copy ไฟล์พัง → database ยังสำรองครบ · exit ≠ 0", () => {
    const r = run({ ...baseEnv(), STUB_FAIL_COPY: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/FAILED database=0 files=1/);
    expect(r.stdout).toMatch(/database backup done/);
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
  ])("%s=%j ผิด → หยุดก่อนทำอะไร", (key, value) => {
    const r = run({ ...baseEnv(), [key]: value });
    expect(r.status).toBe(1);
    expect(rcloneCalls()).toEqual([]);
    expect(read("pg_dump.log")).toBe("");
  });
});

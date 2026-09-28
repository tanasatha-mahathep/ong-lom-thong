// ตัวห่อ TestSprite CLI (ปักเวอร์ชันตรงตัวใน package.json) พร้อม guard แบบ fail-closed — อ่าน README.md ก่อนใช้
//   doctor          ตรวจ CLI · key · project (ชื่อ/ชนิด) · URL เป้าหมาย · โค้ดบน cloud ตรงกับ repo — ไม่ใช้ credit
//   run             doctor → รันทุกเทสต์ของ project แบบรอผล → reports/ → ตรวจโค้ดซ้ำหลังรัน → reports/outcome.json
//   sync [--apply]  อัปโหลดสำเนาที่ commit (sync: true) — ไม่ใส่ --apply = แสดงแผนเฉย ๆ · ห้ามรันใน GitHub Actions
//   classify        อ่าน reports/outcome.json → annotation + step summary · exit 1 เมื่อไม่ได้รันจริง
// env: TESTSPRITE_API_KEY (secret) · TESTSPRITE_PROJECT_ID · TESTSPRITE_PROJECT_NAME · TESTSPRITE_TARGET_URL
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GuardError,
  checkProjectId,
  checkTarget,
  classify,
  compareCode,
  idempotencyKey,
  parseManifest,
  render,
} from "./lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPORTS = join(ROOT, "reports");
const CLI_DIR = join(ROOT, "node_modules", "@testsprite", "testsprite-cli");
const CREDITS_PER_BACKEND_TEST = 0.2; // docs.testsprite.com/cli/core/rerun-and-auto-heal
const IN_ACTIONS = process.env.GITHUB_ACTIONS === "true";

// key ไม่ควรโผล่ใน output ของ CLI อยู่แล้ว — กันอีกชั้น (GitHub mask secret ให้เฉพาะใน Actions)
const redact = (text) => {
  const key = process.env.TESTSPRITE_API_KEY;
  return key && key.length >= 8 ? String(text).split(key).join("***") : String(text);
};
const log = (line) => process.stdout.write(`${redact(line)}\n`);
const annotate = (level, message) =>
  log(IN_ACTIONS ? `::${level}::${message.replace(/\r?\n/g, " ")}` : `[${level}] ${message}`);
const readText = (file) => readFileSync(join(ROOT, file), "utf8");
const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);

// endpoint/โปรไฟล์/--require จาก env ภายนอกห้ามถึง CLI — กัน API key ถูกส่งไป host อื่น · telemetry ปิด
const SCRUBBED_ENV = ["TESTSPRITE_API_URL", "TESTSPRITE_PORTAL_URL", "TESTSPRITE_PROFILE", "NODE_OPTIONS"];
function cliEnv() {
  const env = {
    ...process.env,
    TESTSPRITE_NO_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
    TESTSPRITE_NO_UPDATE_NOTIFIER: "1",
    TESTSPRITE_NO_SKILL_WARNING: "1",
  };
  for (const name of SCRUBBED_ENV) delete env[name];
  return env;
}

function cliInstall() {
  const pkg = JSON.parse(readFileSync(join(CLI_DIR, "package.json"), "utf8"));
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.testsprite;
  if (!bin) throw new GuardError("หา bin ของ @testsprite/testsprite-cli ไม่เจอ — pnpm install --frozen-lockfile");
  return { version: pkg.version, entry: join(CLI_DIR, bin) };
}

function cli(args, { stderr = "pipe" } = {}) {
  const res = spawnSync(process.execPath, [cliInstall().entry, ...args], {
    cwd: ROOT,
    env: cliEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", stderr],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** error envelope ของ CLI ({error: {code, message, nextAction}}) → ข้อความสั้น ๆ */
function describeFailure(res) {
  for (const text of [res.stderr, res.stdout]) {
    try {
      const { error } = JSON.parse(text);
      if (error?.code) return `${error.code}: ${error.message ?? ""} ${error.nextAction ?? ""}`.trim().slice(0, 400);
    } catch {
      // ไม่ใช่ JSON — ลองอีกช่อง
    }
  }
  return res.stderr.trim().split("\n").slice(-2).join(" · ").slice(0, 400);
}

function cliJson(args) {
  const label = `testsprite ${args.slice(0, 2).join(" ")}`;
  const res = cli(["--output", "json", ...args]);
  if (res.status !== 0) throw new GuardError(`${label} → exit ${res.status} — ${describeFailure(res)}`);
  try {
    return JSON.parse(res.stdout);
  } catch {
    throw new GuardError(`${label}: ผลไม่ใช่ JSON`);
  }
}

function loadContext() {
  const manifest = parseManifest(JSON.parse(readText("testsprite.json")), {
    fileExists: (file) => existsSync(join(ROOT, file)),
    readFile: readText,
  });
  if (!process.env.TESTSPRITE_API_KEY) throw new GuardError("ไม่มี TESTSPRITE_API_KEY (repo secret) — ไม่รัน");
  const projectId = checkProjectId(process.env.TESTSPRITE_PROJECT_ID);
  const projectName = process.env.TESTSPRITE_PROJECT_NAME ?? "";
  const target = checkTarget({ projectName, targetUrl: process.env.TESTSPRITE_TARGET_URL ?? "" }, manifest);
  return { manifest, projectId, projectName, target };
}

function checkCli() {
  const pinned = JSON.parse(readText("package.json")).devDependencies?.["@testsprite/testsprite-cli"];
  if (!/^\d+\.\d+\.\d+$/.test(pinned ?? ""))
    throw new GuardError(`ต้องปัก @testsprite/testsprite-cli ตรงตัว (ได้ ${pinned})`);
  const { version } = cliInstall();
  const reported = cli(["--version"]).stdout.trim();
  if (version !== pinned || reported !== pinned) {
    throw new GuardError(`CLI ที่ติดตั้ง ${version}/${reported} ≠ ที่ปัก ${pinned} — pnpm install --frozen-lockfile`);
  }
  return pinned;
}

function checkProject({ projectId, projectName, target }) {
  const project = cliJson(["project", "get", projectId]);
  if (project.name !== projectName) {
    throw new GuardError(`project ${projectId} ชื่อ "${project.name}" ≠ TESTSPRITE_PROJECT_NAME "${projectName}"`);
  }
  if (project.type !== "backend") throw new GuardError(`project ${projectId} เป็น ${project.type} — ต้องเป็น backend`);
  // backend test ใช้ URL ในโค้ด แต่ URL ที่ project เก็บไว้ (ถ้า server ส่งมา) ก็ต้องเป็นเป้าหมายเดียวกัน
  if (project.targetUrl) {
    let origin;
    try {
      origin = new URL(project.targetUrl).origin;
    } catch {
      throw new GuardError(`project targetUrl อ่านไม่ได้ (${project.targetUrl})`);
    }
    if (origin !== target.origin) throw new GuardError(`project targetUrl ${origin} ≠ ${target.origin}`);
  }
  return project;
}

function listTests(projectId) {
  const res = cliJson(["test", "list", "--project", projectId, "--page-size", "100", "--max-items", "500"]);
  if (res.nextToken) throw new GuardError("project มีเทสต์เกิน 500 — ไม่ใช่ project เฉพาะของ repo นี้");
  return res.items ?? [];
}

/** จับคู่เทสต์บน cloud กับ manifest ด้วยชื่อ — ชื่อซ้ำ = กำกวม = หยุด */
function matchTests(manifest, cloudTests) {
  const byName = new Map();
  for (const t of cloudTests) byName.set(t.name, [...(byName.get(t.name) ?? []), t]);
  const duplicates = [...byName].filter(([, list]) => list.length > 1).map(([name]) => name);
  if (duplicates.length) throw new GuardError(`ชื่อเทสต์ซ้ำบน cloud: ${duplicates.join(", ")}`);
  const wanted = manifest.tests.filter((t) => t.sync);
  const wantedNames = new Set(wanted.map((t) => t.name));
  return {
    managed: wanted.filter((t) => byName.has(t.name)).map((entry) => ({ entry, cloud: byName.get(entry.name)[0] })),
    missing: wanted.filter((t) => !byName.has(t.name)),
    unmanaged: cloudTests.filter((t) => !wantedNames.has(t.name)),
  };
}

/** โค้ดบน cloud ต้องตรงกับ repo (render แล้ว) — ไม่พิมพ์โค้ดออก log เพราะอาจมี credential ที่ TestSprite แทรกไว้ */
function findDrift(ctx, managed) {
  const drift = [];
  for (const { entry, cloud } of managed) {
    if (cloud.type !== "backend") {
      drift.push(`${entry.name}: ชนิด ${cloud.type}`);
      continue;
    }
    const remote = cliJson(["test", "code", "get", cloud.id]);
    const cmp = compareCode(remote.code, render(readText(entry.file), ctx.target.origin));
    if (!cmp.same) drift.push(`${entry.name} (${cloud.id}): ${cmp.reason}`);
  }
  return drift;
}

function doctor(ctx) {
  const version = checkCli();
  log(`✓ CLI ${version} (ปักตรงตัว)`);
  const known = ctx.manifest.tests.filter((t) => t.knownFailure).map((t) => t.knownFailure.id);
  log(
    `✓ testsprite.json: ${ctx.manifest.tests.length} เทสต์ · sync ${ctx.manifest.tests.filter((t) => t.sync).length}`,
  );
  if (known.length) log(`· known failure ที่ยังไม่ sync: ${known.join(", ")}`);
  log("✓ TESTSPRITE_API_KEY มีค่า (ไม่แสดง)");
  checkProject(ctx);
  log(`✓ project ${ctx.projectId} "${ctx.projectName}" · backend`);
  log(`✓ เป้าหมาย ${ctx.target.origin} (environment ${ctx.target.env})`);

  const { managed, missing, unmanaged } = matchTests(ctx.manifest, listTests(ctx.projectId));
  const problems = [
    ...missing.map((t) => `ยังไม่ได้ sync: ${t.name} — รัน sync --apply`),
    ...unmanaged.map((t) => `เทสต์นอก manifest: ${t.name} (${t.id}) — commit เข้า repo หรือลบบน TestSprite`),
    ...findDrift(ctx, managed).map((d) => `โค้ดบน cloud ไม่ตรง repo: ${d} — sync --apply`),
  ];
  if (problems.length) throw new GuardError(problems.join(" | "));
  log(`✓ เทสต์บน cloud ${managed.length} ตัว ตรงกับ repo ทุกตัว`);

  try {
    const usage = cliJson(["usage"]);
    const remaining = usage.activeOrg?.remaining ?? usage.credits;
    const cost = (managed.length * CREDITS_PER_BACKEND_TEST).toFixed(1);
    log(`· credit คงเหลือ ${remaining ?? "ไม่ทราบ"} · รอบนี้ประมาณ ${cost}`);
  } catch (e) {
    if (!(e instanceof GuardError)) throw e;
    log(`· อ่าน credit ไม่ได้ (${e.message})`);
  }
  return { managed };
}

function run() {
  mkdirSync(REPORTS, { recursive: true });
  const outcome = { startedAt: new Date().toISOString() };
  let result;
  try {
    outcome.cliVersion = cliInstall().version;
    const ctx = loadContext();
    Object.assign(outcome, { projectId: ctx.projectId, projectName: ctx.projectName, target: ctx.target.origin });
    const { managed } = doctor(ctx);
    // stderr ปล่อยออก log ตรง ๆ — ::error annotation ของ CLI (GITHUB_ACTIONS=true) ต้องถึง GitHub
    const res = cli(
      [
        "--output",
        "json",
        "test",
        "run",
        "--all",
        "--project",
        ctx.projectId,
        "--wait",
        "--timeout",
        "600",
        "--report",
        "junit",
        "--report-file",
        join(REPORTS, "junit.xml"),
        "--summary-file",
        join(REPORTS, "summary.json"),
      ],
      { stderr: "inherit" },
    );
    writeFileSync(join(REPORTS, "run.json"), res.stdout);
    outcome.exitCode = res.status;
    outcome.summary = readJson(join(REPORTS, "summary.json"));
    result = classify(res.status, outcome.summary);
    // ตรวจซ้ำหลังรัน: โค้ดถูกแก้ระหว่างรัน (auto-heal/คน) = ผลเชื่อไม่ได้
    const drift = findDrift(ctx, managed);
    if (drift.length) {
      result = {
        category: "integrity",
        ran: false,
        level: "error",
        message: `โค้ดบน cloud เปลี่ยนระหว่างรัน: ${drift.join(" | ")}`,
      };
    }
  } catch (e) {
    if (!(e instanceof GuardError)) throw e;
    result = { category: "guard", ran: false, level: "error", message: `ไม่ได้รันจริง: ${e.message}` };
  }
  writeFileSync(
    join(REPORTS, "outcome.json"),
    `${JSON.stringify({ ...outcome, ...result, finishedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  // annotation ออกที่ขั้น classify ขั้นเดียว (ไม่ซ้ำ) — ตรงนี้พิมพ์ลง log
  log(`${result.category}: ${result.message}`);
  process.exitCode = result.category === "passed" ? 0 : 1;
}

function sync(ctx, apply) {
  if (apply && IN_ACTIONS)
    throw new GuardError("sync --apply ไม่รันใน GitHub Actions — CI อ่าน/รันอย่างเดียว คนเป็นคน sync");
  checkCli();
  checkProject(ctx);
  const { managed, missing, unmanaged } = matchTests(ctx.manifest, listTests(ctx.projectId));
  const plan = missing.map((entry) => ({
    action: "create",
    entry,
    code: render(readText(entry.file), ctx.target.origin),
  }));
  for (const { entry, cloud } of managed) {
    const code = render(readText(entry.file), ctx.target.origin);
    const remote = cliJson(["test", "code", "get", cloud.id]);
    if (!compareCode(remote.code, code).same)
      plan.push({ action: "update", entry, cloud, code, version: remote.codeVersion });
  }
  log(`เป้าหมาย ${ctx.target.origin} · project "${ctx.projectName}"`);
  for (const p of plan) log(`${p.action === "create" ? "+ สร้าง" : "~ แทนโค้ด"} ${p.entry.name} ← ${p.entry.file}`);
  for (const t of ctx.manifest.tests.filter((x) => x.knownFailure))
    log(`· ข้าม ${t.name} (known failure ${t.knownFailure.id})`);
  for (const t of unmanaged)
    log(`! นอก manifest: ${t.name} (${t.id}) — ตรวจแล้วลบเอง: testsprite test delete ${t.id} --confirm`);
  if (plan.length === 0) log("ตรงกับ repo แล้ว — ไม่มีอะไรต้อง sync");
  if (!apply || plan.length === 0) {
    if (!apply && plan.length) log("dry-run — ยังไม่เขียนอะไร · รันซ้ำด้วย --apply");
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), "ong-testsprite-"));
  try {
    for (const p of plan) {
      const file = join(dir, `${p.entry.name}.py`);
      writeFileSync(file, p.code);
      if (p.action === "create") {
        const deps = [
          ...p.entry.produces.flatMap((v) => ["--produces", v]),
          ...p.entry.needs.flatMap((v) => ["--needs", v]),
        ];
        const created = cliJson([
          ...["test", "create", "--project", ctx.projectId, "--type", "backend"],
          ...["--name", p.entry.name, "--description", p.entry.description, "--code-file", file],
          ...["--idempotency-key", idempotencyKey("create", p.entry.name, p.code), ...deps],
        ]);
        log(`+ ${p.entry.name} → ${created.testId}`);
      } else {
        cliJson([
          ...["test", "code", "put", p.cloud.id, "--code-file", file, "--language", "python"],
          ...["--expected-version", p.version, "--idempotency-key", idempotencyKey("put", p.entry.name, p.code)],
        ]);
        log(`~ ${p.entry.name} (${p.cloud.id})`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const after = matchTests(ctx.manifest, listTests(ctx.projectId));
  const drift = [...after.missing.map((t) => `${t.name}: ไม่พบหลังสร้าง`), ...findDrift(ctx, after.managed)];
  if (drift.length) throw new GuardError(`sync แล้วยังไม่ตรง: ${drift.join(" | ")}`);
  log(`✓ sync แล้ว ${plan.length} เทสต์ — ตรงกับ repo`);
}

function classifyCommand() {
  const outcome = readJson(join(REPORTS, "outcome.json")) ?? {
    category: "no-outcome",
    ran: false,
    level: "error",
    message: "ไม่ได้รันจริง: ไม่มี reports/outcome.json (ขั้น run ล้มก่อนเขียนผล)",
  };
  annotate(outcome.level, `TestSprite: ${outcome.message}`);
  const s = outcome.summary;
  const rows = [
    ["หมวด", `\`${outcome.category}\``],
    ["project", outcome.projectName ? `${outcome.projectName} (\`${outcome.projectId}\`)` : "—"],
    ["เป้าหมาย", outcome.target ?? "—"],
    ["CLI", outcome.cliVersion ?? "—"],
    ["ผล", s ? `ผ่าน ${s.passed}/${s.total} · ไม่ผ่าน ${s.failed} · timeout ${s.timedOut} · ข้าม ${s.skipped}` : "—"],
  ];
  const markdown = [
    `### TestSprite (advisory) — ${outcome.ran ? "ได้รัน" : "ไม่ได้รัน"}`,
    "",
    outcome.message,
    "",
    "| | |",
    "| --- | --- |",
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "ผลรายเทสต์: ตารางของ CLI (ถ้ามี) · หลักฐาน: artifact `testsprite-*` เก็บ 7 วัน · คู่มือ: tests/testsprite/README.md",
    "",
  ].join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  else log(markdown);
  process.exitCode = outcome.ran ? 0 : 1;
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "doctor") doctor(loadContext());
  else if (command === "run") run();
  else if (command === "sync") sync(loadContext(), args.includes("--apply"));
  else if (command === "classify") classifyCommand();
  else {
    log("usage: node scripts/testsprite.js doctor | run | sync [--apply] | classify");
    process.exitCode = 2;
  }
} catch (e) {
  if (!(e instanceof GuardError)) throw e;
  annotate("error", `TestSprite guard: ${e.message}`);
  process.exitCode = 1;
}

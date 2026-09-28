// ตรรกะล้วนของตัวห่อ TestSprite (ไม่มี I/O · ไม่มี network) — เทสต์ด้วย `node --test scripts/`
import { createHash } from "node:crypto";

/** บรรทัดเดียวในไฟล์เทสต์ที่ sync แทนด้วย URL จริง — TestSprite ไม่ส่ง target เข้า sandbox ของ backend test */
export const BASE_URL_LINE = 'BASE_URL = os.environ.get("ONG_BASE_URL", "").rstrip("/")';

/** ท้ายไฟล์ต้องเรียกเทสต์เอง (TestSprite รันจากบนลงล่าง ไม่ collect) — ไม่มี = ผ่านแบบว่างเปล่า */
export const RUNNER_GUARD_LINE = 'if os.environ.get("ONG_PROBE_RUNNER") != "pytest":';

/** บล็อก credential ที่ TestSprite แทรกไว้หน้าโค้ด (`project credential`) — นอกนั้นถือว่าโค้ดถูกแก้บน cloud */
const MANAGED_LINE = /^\s*$|^\s*#.*$|^__AUTH_[A-Z_]+__\s*=.*$/;
const TEST_NAME = /^ong-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export class GuardError extends Error {}

const fail = (message) => {
  throw new GuardError(message);
};

export const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/** ตรวจ testsprite.json ให้ครบก่อนใช้ — ผิดรูป = หยุด (fail-closed) */
export function parseManifest(manifest, { fileExists, readFile }) {
  const project = manifest?.project;
  if (project?.type !== "backend") fail('testsprite.json: project.type ต้องเป็น "backend"');
  if (typeof project.name_pattern !== "string") fail("testsprite.json: project.name_pattern ต้องเป็น string");
  let namePattern;
  try {
    namePattern = new RegExp(project.name_pattern);
  } catch {
    fail("testsprite.json: project.name_pattern ไม่ใช่ regex");
  }
  if (!project.name_pattern.startsWith("^") || !project.name_pattern.endsWith("$")) {
    fail("testsprite.json: project.name_pattern ต้องยึดหัวท้าย (^…$)");
  }
  const hosts = project.hosts ?? {};
  if (Object.keys(hosts).length === 0) fail("testsprite.json: project.hosts ว่าง");
  for (const [env, host] of Object.entries(hosts)) {
    if (!/^[a-z0-9.-]+$/.test(host) || /prod/i.test(env) || /prod/i.test(host)) {
      fail(`testsprite.json: host ของ ${env} ไม่ถูกต้อง (${host})`);
    }
  }

  if (!Array.isArray(manifest.tests) || manifest.tests.length === 0) fail("testsprite.json: tests ว่าง");
  const names = new Set();
  const tests = manifest.tests.map((entry, i) => {
    const where = `testsprite.json tests[${i}]`;
    const { file, name, description, sync } = entry ?? {};
    if (typeof file !== "string" || !/^backend\/test_[a-z0-9_]+\.py$/.test(file)) fail(`${where}: file ${file}`);
    if (!fileExists(file)) fail(`${where}: ไม่พบไฟล์ ${file}`);
    if (typeof name !== "string" || !TEST_NAME.test(name)) fail(`${where}: name ต้องเป็น ong-… (${name})`);
    if (names.has(name)) fail(`${where}: name ซ้ำ ${name}`);
    names.add(name);
    if (typeof description !== "string" || description.length === 0 || description.length > 2000) {
      fail(`${where}: description ต้องมี (≤ 2000 ตัวอักษร)`);
    }
    if (typeof sync !== "boolean") fail(`${where}: sync ต้องเป็น true/false`);
    const produces = entry.produces ?? [];
    const needs = entry.needs ?? [];
    for (const v of [...produces, ...needs]) if (!VAR_NAME.test(v)) fail(`${where}: ชื่อตัวแปร ${v}`);

    const source = readFile(file);
    const defined = new Set([...source.matchAll(/^def (test_\w+)\(/gm)].map((m) => m[1]));
    if (defined.size === 0) fail(`${where}: ไม่มี def test_…`);
    const known = entry.known_failure;
    if (known !== undefined) {
      if (sync) fail(`${where}: known_failure ห้าม sync (เทสต์ที่รู้ว่าพังทำให้ผลทุกคืนแดงโดยไม่มีข่าวใหม่)`);
      if (!/^F\d+$/.test(known.id ?? "") || !known.title || !Array.isArray(known.tests) || known.tests.length === 0) {
        fail(`${where}: known_failure ต้องมี id (F<n>) · title · tests[]`);
      }
      for (const t of known.tests) if (!defined.has(t)) fail(`${where}: known_failure.tests มี ${t} ที่ไม่มีในไฟล์`);
    }
    if (sync) checkSyncable(source, where);
    return { file, name, description, sync, produces, needs, knownFailure: known };
  });
  return { namePattern, hosts, tests };
}

/** ไฟล์ที่จะขึ้น TestSprite: มีบรรทัด BASE_URL เดียว และเรียกเทสต์เองท้ายไฟล์ */
export function checkSyncable(source, where = "file") {
  const lines = source.split("\n");
  if (lines.filter((l) => l === BASE_URL_LINE).length !== 1)
    fail(`${where}: ต้องมีบรรทัด ${BASE_URL_LINE} หนึ่งบรรทัด`);
  if (!lines.includes(RUNNER_GUARD_LINE)) fail(`${where}: ต้องเรียกเทสต์เองท้ายไฟล์ (${RUNNER_GUARD_LINE})`);
}

/**
 * ชื่อ project + URL เป้าหมายต้องตรงกัน: ชื่อตามรูปแบบ → environment → host ใน allow-list เท่านั้น
 * https เท่านั้น · ไม่มี path/query/credential/port · ชื่อหรือ host ที่มี "prod" = ปฏิเสธเสมอ
 */
export function checkTarget({ projectName, targetUrl }, { namePattern, hosts }) {
  if (typeof projectName !== "string" || /prod/i.test(projectName))
    fail(`ชื่อ project ${projectName} ห้ามชี้ production`);
  const match = namePattern.exec(projectName);
  if (!match) fail(`ชื่อ project "${projectName}" ไม่ตรงรูปแบบ ${namePattern.source}`);
  const env = match[1];
  const host = hosts[env];
  if (!host) fail(`ไม่มี host ของ environment "${env}" ใน testsprite.json`);
  let url;
  try {
    url = new URL(targetUrl);
  } catch {
    fail(`TESTSPRITE_TARGET_URL ไม่ใช่ URL (${targetUrl})`);
  }
  if (url.protocol !== "https:") fail("TESTSPRITE_TARGET_URL ต้องเป็น https");
  if (url.username || url.password || url.port || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    fail("TESTSPRITE_TARGET_URL ต้องเป็น origin ล้วน (ไม่มี path · query · port · credential)");
  }
  if (url.hostname !== host) fail(`TESTSPRITE_TARGET_URL host ${url.hostname} ไม่ใช่ ${host} ของ environment "${env}"`);
  return { env, origin: url.origin };
}

export function checkProjectId(id) {
  if (typeof id !== "string" || !PROJECT_ID.test(id)) fail("TESTSPRITE_PROJECT_ID ว่างหรือรูปแบบไม่ถูกต้อง");
  return id;
}

const normalize = (code) => code.replace(/\r\n?/g, "\n").replace(/\s+$/, "");

/** สำเนาที่ขึ้น cloud = ไฟล์ใน repo ที่แทนบรรทัด BASE_URL ด้วย origin ที่ผ่าน checkTarget แล้ว */
export function render(source, origin) {
  const where = "render";
  checkSyncable(source, where);
  const rendered = source
    .split("\n")
    .map((l) =>
      l === BASE_URL_LINE ? `BASE_URL = ${JSON.stringify(origin)}  # ตั้งโดย scripts/testsprite.js sync` : l,
    )
    .join("\n");
  return `${normalize(rendered)}\n`;
}

/** โค้ดบน cloud ต้องตรงกับที่ render จาก repo · ยอมเฉพาะบล็อก credential ของ TestSprite ข้างหน้า */
export function compareCode(cloudCode, expected) {
  const cloud = normalize(cloudCode ?? "");
  const want = normalize(expected);
  if (cloud === want) return { same: true, managedBlock: false };
  if (!cloud.endsWith(want)) return { same: false, reason: "โค้ดต่างจากที่ commit" };
  const prefix = cloud.slice(0, cloud.length - want.length);
  const unexpected = prefix.split("\n").find((l) => !MANAGED_LINE.test(l));
  return unexpected === undefined
    ? { same: true, managedBlock: true }
    : { same: false, reason: "มีโค้ดอื่นแทรกหน้าโค้ดที่ commit" };
}

/** idempotency key ที่ retry ได้ปลอดภัย: ชื่อเทสต์ + hash ของโค้ด (ASCII ≤ 256) */
export const idempotencyKey = (action, name, code) => `ong-${action}-${name}-${sha256(code).slice(0, 16)}`;

const NOT_RUN = {
  2: ["cli-error", "CLI ทำคำสั่งนี้ไม่ได้ (not implemented)"],
  3: ["auth", "API key ใช้ไม่ได้/หมดอายุ — ออก key ใหม่แล้วแก้ secret TESTSPRITE_API_KEY"],
  4: ["not-found", "ไม่พบ project/เทสต์ — ตรวจ TESTSPRITE_PROJECT_ID แล้ว sync ใหม่"],
  5: ["validation", "TestSprite ปฏิเสธคำขอ (รวมถึงไม่มีเทสต์ให้รัน) — ดู log ของขั้น run"],
  6: ["conflict", "มีรอบที่รันค้างอยู่ — รอให้จบหรือ testsprite test cancel"],
  7: ["timeout", "รอผลเกินเวลา — ดู testsprite test wait <run-id>"],
  10: ["unavailable", "ต่อ TestSprite ไม่ได้ (network/บริการล่ม) — รอบหน้าจะลองใหม่"],
  11: ["rate-limited", "โดนจำกัดอัตรา — ลดความถี่/รอ"],
  12: ["credits", "credit หมด — ดู testsprite usage (free 150/เดือน · backend 0.2/เทสต์)"],
  13: ["feature-gated", "ฟีเจอร์นี้ไม่อยู่ในแผนที่ใช้"],
  14: ["client-too-old", "CLI เก่ากว่าที่ server รับ — อัปเดต @testsprite/testsprite-cli (Renovate) แล้ว merge"],
};

/**
 * exit code ของ `test run --all --wait` + summary → หมวดผล
 * advisory: passed / tests-failed ไม่ทำให้ job แดง · ไม่ได้รันจริงทุกแบบ = แดง (ชั้นเทสต์ที่ตายเงียบห้ามดูเขียว)
 */
export function classify(exitCode, summary) {
  if (exitCode === 0) {
    return { category: "passed", ran: true, level: "notice", message: "เทสต์บน TestSprite ผ่านทั้งหมด" };
  }
  const total = Number(summary?.total ?? 0);
  if (exitCode === 1 && total > 0) {
    const notPassed = total - Number(summary.passed ?? 0);
    return {
      category: "tests-failed",
      ran: true,
      level: "warning",
      message: `เทสต์บน TestSprite ไม่ผ่าน ${notPassed}/${total} (advisory — ตรวจแล้วแก้โค้ดหรือเทสต์)`,
    };
  }
  const [category, message] = NOT_RUN[exitCode] ?? [
    "error",
    exitCode === 1 ? "CLI ล้มโดยไม่มีผลเทสต์ (INTERNAL)" : `CLI จบด้วย exit ${exitCode}`,
  ];
  return { category, ran: false, level: "error", message: `ไม่ได้รันจริง: ${message}` };
}

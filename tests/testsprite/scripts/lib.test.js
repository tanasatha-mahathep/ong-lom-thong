// node --test scripts/lib.test.js — guard ของตัวห่อ TestSprite (ไม่มี network · ไม่ต้องมี key)
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { BASE_URL_LINE, RUNNER_GUARD_LINE, checkTarget, classify, compareCode, parseManifest, render } from "./lib.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const io = { fileExists: (f) => existsSync(join(ROOT, f)), readFile: (f) => readFileSync(join(ROOT, f), "utf8") };
const realManifest = () => JSON.parse(readFileSync(join(ROOT, "testsprite.json"), "utf8"));
const manifest = parseManifest(realManifest(), io);
const TESTING = "https://ong-lom-thong-testing.up.railway.app";
const SOURCE = [
  "import os",
  "",
  BASE_URL_LINE,
  "",
  "def test_x():",
  "    pass",
  "",
  RUNNER_GUARD_LINE,
  "    test_x()",
  "",
].join("\n");

describe("testsprite.json (ของจริงใน repo)", () => {
  it("ผ่านการตรวจ · ไฟล์ที่ sync ทุกไฟล์ render ได้ · known failure ไม่ sync", () => {
    for (const t of manifest.tests) {
      if (t.sync) assert.match(render(io.readFile(t.file), TESTING), /^BASE_URL = "https:\/\/ong-lom-thong-testing/m);
      if (t.knownFailure) assert.equal(t.sync, false);
    }
    assert.ok(manifest.tests.some((t) => t.sync));
  });

  const broken = (mutate) => {
    const m = realManifest();
    mutate(m);
    return () => parseManifest(m, io);
  };
  // manifest จริงไม่มี known failure แล้ว (F1/F2 แก้ใน PR #61) — สร้างเองบนไฟล์ test_health.py
  const markKnownFailure = (m, sync, tests = ["test_root_healthz"]) => {
    const entry = m.tests.find((t) => t.file === "backend/test_health.py");
    entry.known_failure = { id: "F9", title: "ทดสอบ", tests };
    entry.sync = sync;
  };
  it("known failure ที่ไม่ sync = ผ่าน · ตั้ง sync: true = ปฏิเสธ", () => {
    const m = realManifest();
    markKnownFailure(m, false);
    assert.equal(parseManifest(m, io).tests.find((t) => t.knownFailure)?.knownFailure.id, "F9");
    assert.throws(
      broken((x) => markKnownFailure(x, true)),
      /known_failure ห้าม sync/,
    );
  });
  it("ชื่อซ้ำ / ชื่อผิดรูป / known_failure อ้างเทสต์ที่ไม่มี = ปฏิเสธ", () => {
    assert.throws(
      broken((m) => (m.tests[1].name = m.tests[0].name)),
      /name ซ้ำ/,
    );
    assert.throws(
      broken((m) => (m.tests[0].name = "Health Check")),
      /name ต้องเป็น ong-/,
    );
    assert.throws(
      broken((m) => markKnownFailure(m, false, ["test_nope"])),
      /test_nope/,
    );
  });
  it("host ที่มีคำว่า prod = ปฏิเสธ", () => {
    assert.throws(
      broken((m) => (m.project.hosts.testing = "ong-lom-thong-prod.up.railway.app")),
      /host ของ testing/,
    );
  });
});

describe("checkTarget — ชื่อ project + URL ต้องชี้ environment เดียวกันใน allow-list", () => {
  const ok = (projectName, targetUrl) => checkTarget({ projectName, targetUrl }, manifest);
  it("testing / staging-readonly ที่ตรงคู่ = ผ่าน", () => {
    assert.deepEqual(ok("ong-lom-thong-testing-backend", `${TESTING}/`), { env: "testing", origin: TESTING });
    assert.equal(
      ok("ong-lom-thong-staging-readonly-backend", "https://ong-lom-thong-staging.up.railway.app").env,
      "staging-readonly",
    );
  });
  for (const [why, name, url] of [
    ["production host", "ong-lom-thong-testing-backend", "https://ong-lom-thong.up.railway.app"],
    ["ชื่อมี prod", "ong-lom-thong-prod-backend", TESTING],
    ["ชื่อไม่ตรงรูปแบบ", "ong-lom-thong-staging-backend", "https://ong-lom-thong-staging.up.railway.app"],
    ["ไขว้ environment", "ong-lom-thong-testing-backend", "https://ong-lom-thong-staging.up.railway.app"],
    ["http", "ong-lom-thong-testing-backend", "http://ong-lom-thong-testing.up.railway.app"],
    ["path", "ong-lom-thong-testing-backend", `${TESTING}/api`],
    ["query", "ong-lom-thong-testing-backend", `${TESTING}/?x=1`],
    ["port", "ong-lom-thong-testing-backend", `${TESTING}:8443`],
    ["credential", "ong-lom-thong-testing-backend", "https://u:p@ong-lom-thong-testing.up.railway.app"],
    ["โดเมนหลอก", "ong-lom-thong-testing-backend", `${TESTING}.evil.example`],
    ["localhost", "ong-lom-thong-testing-backend", "https://localhost"],
    ["ว่าง", "ong-lom-thong-testing-backend", ""],
  ]) {
    it(`ปฏิเสธ: ${why}`, () => assert.throws(() => ok(name, url)));
  }
});

describe("render — สำเนาที่ขึ้น cloud", () => {
  it("แทนบรรทัด BASE_URL เดียวด้วย origin เป็น string literal", () => {
    const out = render(SOURCE, TESTING);
    assert.ok(out.includes(`BASE_URL = "${TESTING}"`));
    assert.ok(!out.includes("ONG_BASE_URL"));
    assert.ok(out.endsWith("    test_x()\n"));
  });
  it("ไม่มี / มีสองบรรทัด / ไม่เรียกเทสต์เองท้ายไฟล์ = ปฏิเสธ", () => {
    assert.throws(() => render(SOURCE.replace(BASE_URL_LINE, 'BASE_URL = "x"'), TESTING));
    assert.throws(() => render(`${BASE_URL_LINE}\n${SOURCE}`, TESTING));
    assert.throws(() => render(SOURCE.replace(RUNNER_GUARD_LINE, "if True:"), TESTING));
  });
});

describe("compareCode — โค้ดบน cloud ต้องตรงกับ repo", () => {
  const want = render(SOURCE, TESTING);
  it("ตรงกัน (ไม่สน CRLF / newline ท้ายไฟล์)", () => {
    assert.equal(compareCode(want.replace(/\n/g, "\r\n") + "\n\n", want).same, true);
  });
  it("ยอมบล็อก credential ที่ TestSprite แทรกข้างหน้า", () => {
    const managed = [
      "# Auto-injected credentials — do not modify",
      '__AUTH_CREDENTIAL__ = "x"',
      '__AUTH_TYPE__       = "public"',
      "__AUTH_HEADERS__    = {}",
      "",
      want,
    ].join("\n");
    assert.deepEqual(compareCode(managed, want), { same: true, managedBlock: true });
  });
  it("มีโค้ดอื่นแทรก / body ถูกแก้ = ไม่ตรง", () => {
    assert.equal(compareCode(`import os\nos.system("id")\n${want}`, want).same, false);
    assert.equal(compareCode(want.replace("pass", "assert True"), want).same, false);
    assert.equal(compareCode(undefined, want).same, false);
  });
});

describe("classify — advisory เฉพาะผลเทสต์ · ไม่ได้รัน = แดง", () => {
  it("0 = passed · 1 + summary = tests-failed (warning)", () => {
    assert.deepEqual([classify(0, null).category, classify(0, null).ran], ["passed", true]);
    const failed = classify(1, { total: 6, passed: 5, failed: 1, timedOut: 0, skipped: 0 });
    assert.deepEqual([failed.category, failed.ran, failed.level], ["tests-failed", true, "warning"]);
    assert.match(failed.message, /1\/6/);
  });
  for (const [code, category] of [
    [1, "error"],
    [3, "auth"],
    [5, "validation"],
    [7, "timeout"],
    [12, "credits"],
    [14, "client-too-old"],
    [99, "error"],
  ]) {
    it(`exit ${code} = ${category} (ไม่ได้รัน)`, () => {
      const r = classify(code, code === 1 ? { total: 0 } : null);
      assert.deepEqual([r.category, r.ran, r.level], [category, false, "error"]);
    });
  }
});

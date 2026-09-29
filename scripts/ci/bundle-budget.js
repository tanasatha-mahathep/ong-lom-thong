// Web bundle budget: gzip size of the JS and CSS that Vite writes to apps/web/dist, checked against
// scripts/ci/bundle-budget.json. Zero dependencies (node: builtins only), Node 22+.
// gzip runs at the budget file's "gzipLevel" (6 = zlib's default, which is what the "gzip:" column of the
// `vite build` log uses), so the per-file sizes match the numbers developers see in the build output.
//
// Run:    pnpm build && node scripts/ci/bundle-budget.js   (--help lists the options)
// Exit:   0 = within budget, 1 = over budget, 2 = usage or config error (e.g. no build output yet)
// Update: when growth is intended, rebuild and run this script, copy the new sizes into "measured" (with the
//         date and short commit), set each "budget" value to measured * (1 + headroom) rounded up to the
//         next 1000 B, and give the reason in the commit body.
import { appendFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { constants as zlib, gzipSync } from "node:zlib";

const ROOT = resolve(import.meta.dirname, "../..");
const DEFAULT_DIST = join(ROOT, "apps/web/dist");
const DEFAULT_BUDGET = join(import.meta.dirname, "bundle-budget.json");
// Vite's build reporter calls zlib gzip() without options: Z_DEFAULT_COMPRESSION, which zlib runs as level 6.
// Sizes come from Node's bundled zlib, as in Vite; the gzip CLI (another zlib build) gives slightly different sizes.
const VITE_GZIP_LEVEL = 6;
const METRICS = ["totalJsGzipBytes", "totalCssGzipBytes", "largestJsChunkGzipBytes"];
const COLUMNS = ["metric", "gzip", "budget", "used", "status"];
const KIND_BY_EXT = { ".js": "js", ".mjs": "js", ".css": "css" };
const USAGE = `Usage: node scripts/ci/bundle-budget.js [--dist <dir>] [--budget <file>]

  --dist <dir>     Vite build output to measure (default: apps/web/dist)
  --budget <file>  budget JSON (default: scripts/ci/bundle-budget.json)
  --help           show this help

Exit codes: 0 within budget, 1 over budget, 2 usage or config error.`;

// 1 kB = 1000 B shown with two decimals, the same display as Vite's build log.
const kBFormat = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const byteFormat = new Intl.NumberFormat("en");
const percentFormat = new Intl.NumberFormat("en", { style: "percent", minimumFractionDigits: 1 });
const kB = (bytes) => `${kBFormat.format(bytes / 1000)} kB`;
const size = (bytes) => `${kB(bytes)} (${byteFormat.format(bytes)} B)`;
const sum = (files, key) => files.reduce((total, file) => total + file[key], 0);
const shown = (path) => (path.startsWith(ROOT + sep) ? relative(ROOT, path).split(sep).join("/") : path);
// Workflow command data must escape %, CR and LF (as @actions/core does).
const escapeData = (text) => text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

class UsageError extends Error {}

function parseOptions(args) {
  const options = { dist: { type: "string" }, budget: { type: "string" }, help: { type: "boolean" } };
  try {
    return parseArgs({ args, options }).values;
  } catch (error) {
    throw new UsageError(`${error.message}\n\n${USAGE}`);
  }
}

function readBudget(file) {
  let config;
  try {
    config = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new UsageError(`cannot read budget file ${file}: ${error.message}`);
  }
  const gzipLevel = config?.gzipLevel ?? VITE_GZIP_LEVEL;
  if (!Number.isInteger(gzipLevel) || gzipLevel < zlib.Z_DEFAULT_COMPRESSION || gzipLevel > zlib.Z_BEST_COMPRESSION) {
    throw new UsageError(`${file}: gzipLevel must be an integer from -1 to 9, got ${JSON.stringify(gzipLevel)}`);
  }
  for (const metric of METRICS) {
    const limit = config?.budget?.[metric];
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new UsageError(`${file}: budget.${metric} must be a positive integer, got ${JSON.stringify(limit)}`);
    }
  }
  return { gzipLevel, budget: config.budget };
}

function measure(distDir, gzipLevel) {
  if (!statSync(distDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new UsageError(`no build output at ${distDir}: run pnpm build first`);
  }
  return readdirSync(distDir, { recursive: true })
    .filter((name) => Object.hasOwn(KIND_BY_EXT, extname(name)) && statSync(join(distDir, name)).isFile())
    .sort()
    .map((name) => {
      const content = readFileSync(join(distDir, name));
      const kind = KIND_BY_EXT[extname(name)];
      const gzipBytes = gzipSync(content, { level: gzipLevel }).length;
      return { name: name.split(sep).join("/"), kind, rawBytes: content.length, gzipBytes };
    });
}

function summarize(files, distDir) {
  const js = files.filter((file) => file.kind === "js");
  const css = files.filter((file) => file.kind === "css");
  if (js.length === 0) {
    throw new UsageError(`no .js/.mjs files in ${distDir}: run pnpm build first`);
  }
  const largest = js.reduce((best, file) => (file.gzipBytes > best.gzipBytes ? file : best));
  const values = {
    totalJsGzipBytes: sum(js, "gzipBytes"),
    totalCssGzipBytes: sum(css, "gzipBytes"),
    largestJsChunkGzipBytes: largest.gzipBytes,
  };
  const rawJs = kB(sum(js, "rawBytes"));
  const rawCss = kB(sum(css, "rawBytes"));
  const notes = [
    `largest JS chunk: ${largest.name}`,
    `files: ${js.length} JS (${rawJs} raw), ${css.length} CSS (${rawCss} raw); raw sizes are not budgeted`,
  ];
  return { values, notes };
}

function compare(values, budget) {
  return METRICS.map((metric) => ({
    metric,
    gzip: size(values[metric]),
    budget: size(budget[metric]),
    used: percentFormat.format(values[metric] / budget[metric]),
    status: values[metric] > budget[metric] ? "OVER" : "OK",
  }));
}

function textTable(rows) {
  const rightAligned = new Set(["gzip", "budget", "used"]);
  const lines = [COLUMNS, ...rows.map((row) => COLUMNS.map((column) => row[column]))];
  const widths = COLUMNS.map((_, i) => Math.max(...lines.map((line) => line[i].length)));
  const pad = (cell, i) => (rightAligned.has(COLUMNS[i]) ? cell.padStart(widths[i]) : cell.padEnd(widths[i]));
  return lines.map((line) => line.map(pad).join("  ").trimEnd()).join("\n");
}

function markdownSummary(rows, notes) {
  return [
    "",
    "### Web bundle budget (gzip)",
    "",
    `| ${COLUMNS.join(" | ")} |`,
    "| :-- | --: | --: | --: | :-- |",
    ...rows.map((row) => `| ${COLUMNS.map((column) => row[column]).join(" | ")} |`),
    "",
    ...notes.map((note) => `- ${note}`),
    "",
  ].join("\n");
}

function main(args) {
  const options = parseOptions(args);
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const distDir = resolve(options.dist ?? DEFAULT_DIST);
  const budgetFile = resolve(options.budget ?? DEFAULT_BUDGET);
  const { gzipLevel, budget } = readBudget(budgetFile);
  const { values, notes } = summarize(measure(distDir, gzipLevel), distDir);
  const rows = compare(values, budget);
  notes.push(`gzip level ${gzipLevel}, budget file ${shown(budgetFile)}`);

  console.log(`Web bundle budget (gzip) for ${shown(distDir)}\n\n${textTable(rows)}\n\n${notes.join("\n")}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdownSummary(rows, notes));
  }
  const over = rows.filter((row) => row.status === "OVER");
  if (over.length === 0) return 0;
  if (process.env.GITHUB_ACTIONS === "true") {
    for (const row of over) {
      const message = `${row.metric} is ${row.gzip}, ${row.used} of its ${row.budget} budget`;
      console.log(`::error title=bundle budget::${escapeData(message)}`);
    }
  }
  console.error("\nOver budget. If intended, raise the budget as the header of scripts/ci/bundle-budget.js explains.");
  return 1;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`bundle-budget: ${error instanceof UsageError ? error.message : error.stack}`);
  process.exitCode = 2;
}

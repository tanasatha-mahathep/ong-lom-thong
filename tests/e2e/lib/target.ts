import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What the suite points at. Default = the local stack (stack/compose.yml); E2E_BASE_URL = anything else
 * (deploy-smoke passes the Railway URL). Only the local stack may be written to — elsewhere the api project
 * refuses unless E2E_ALLOW_WRITES=1 says the environment is disposable.
 */
export const LOCAL_BASE_URL = "http://localhost:28787";
const LOCAL_GOTENBERG_URL = "http://localhost:23000";

const baseURL = (process.env.E2E_BASE_URL ?? LOCAL_BASE_URL).replace(/\/+$/, "");
const origin = new URL(baseURL).origin;
const isLocalStack = origin === new URL(LOCAL_BASE_URL).origin;

export const target = {
  baseURL,
  /** what a browser on this site sends as Origin — the api's CSRF check compares against it */
  origin,
  isLocalStack,
  allowWrites: isLocalStack || process.env.E2E_ALLOW_WRITES === "1",
  gotenbergURL: (process.env.E2E_GOTENBERG_URL ?? LOCAL_GOTENBERG_URL).replace(/\/+$/, ""),
} as const;

/** same directory as stack/stack.sh — outside the repo, so nothing here reaches git or the docker build */
export const stateDir = process.env.E2E_STATE_DIR ?? path.join(process.env.TMPDIR ?? "/tmp", "ong-e2e");
export const accountsFile = process.env.E2E_ACCOUNTS_FILE ?? path.join(stateDir, "accounts.json");
export const stackScript = fileURLToPath(new URL("../stack/stack.sh", import.meta.url));

/** secrets stack.sh generated for this stack (KEY=VALUE lines) — {} when the stack is not up */
export function stackEnv(): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(path.join(stateDir, "stack.env"), "utf8");
  } catch {
    return {};
  }
  const entries = text
    .split("\n")
    .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m): [string, string] => [m[1] ?? "", m[2] ?? ""]);
  return Object.fromEntries(entries);
}

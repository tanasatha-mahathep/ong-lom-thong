import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { test as setup } from "@playwright/test";
import { ACCOUNT_KEYS, ACCOUNT_SPECS, type Account, type AccountKey, writeAccounts } from "../../lib/accounts";
import { runId } from "../../lib/synthetic";
import { stackScript, target, writeRefusal } from "../../lib/target";

/**
 * Accounts exist only through the admin script shipped in the image (sign-up is disabled) — so this runs
 * `node dist/create-user.js` inside the api container, password on stdin, exactly like `railway ssh` does.
 * Local stack only: anywhere else the accounts must be handed in (E2E_ACCOUNTS_FILE).
 */
function createUser(account: Account): Promise<void> {
  const args = ["exec", "-T", "api", "node", "dist/create-user.js"];
  args.push("--email", account.email, "--name", account.name, "--role", account.role);
  if (account.branch) args.push("--branch", account.branch);
  if (account.viewAll) args.push("--view-all");

  return new Promise((resolve, reject) => {
    const child = spawn("bash", [stackScript, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`create-user ${account.key} exited ${code}: ${output.trim()}`)),
    );
    child.stdin.end(account.password);
  });
}

setup("create this run's accounts on the local stack", async () => {
  // one clear failure instead of every api test failing: dependants of a failed setup do not run
  if (writeRefusal) throw new Error(writeRefusal);
  setup.skip(!target.isLocalStack, "not the local stack — accounts come from E2E_ACCOUNTS_FILE");
  setup.setTimeout(120_000);

  const accounts = Object.fromEntries(
    ACCOUNT_KEYS.map((key: AccountKey) => {
      const account: Account = {
        key,
        ...ACCOUNT_SPECS[key],
        email: `e2e-${runId}-${key.toLowerCase()}@ong.test`,
        name: `ทดสอบ ${key} ${runId}`,
        password: randomBytes(18).toString("base64url"),
      };
      return [key, account];
    }),
  ) as Record<AccountKey, Account>;

  await Promise.all(Object.values(accounts).map(createUser));
  writeAccounts({ runId, createdAt: new Date().toISOString(), accounts });
});

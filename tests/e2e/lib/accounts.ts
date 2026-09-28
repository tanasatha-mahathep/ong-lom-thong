import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { accountsFile } from "./target";

export type Role = "staff" | "manager" | "accounting" | "admin";

interface AccountSpec {
  role: Role;
  /** home branch code (seeded: 00000 · 00001 · 00002) — none = the account has no branch at all */
  branch?: string;
  viewAll?: boolean;
}

/** One account per role on branch 00000, plus the two fail-closed cases: another branch and no branch. */
export const ACCOUNT_SPECS = {
  staff: { role: "staff", branch: "00000" },
  manager: { role: "manager", branch: "00000" },
  accounting: { role: "accounting", branch: "00000" },
  admin: { role: "admin", branch: "00000", viewAll: true },
  otherBranch: { role: "staff", branch: "00001" },
  noBranch: { role: "staff" },
} as const satisfies Record<string, AccountSpec>;

export type AccountKey = keyof typeof ACCOUNT_SPECS;
export const ACCOUNT_KEYS = Object.keys(ACCOUNT_SPECS) as AccountKey[];

export interface Account extends AccountSpec {
  key: AccountKey;
  email: string;
  name: string;
  password: string;
}

export interface AccountsFile {
  runId: string;
  createdAt: string;
  accounts: Record<AccountKey, Account>;
}

/** written by the setup project (local stack) or handed in through E2E_ACCOUNTS_FILE (disposable remote) */
export function readAccounts(): AccountsFile {
  let text: string;
  try {
    text = readFileSync(accountsFile, "utf8");
  } catch {
    throw new Error(
      `no e2e accounts at ${accountsFile} — run the api project with its setup dependency (not --no-deps), ` +
        "or point E2E_ACCOUNTS_FILE at the accounts of a disposable environment",
    );
  }
  return JSON.parse(text) as AccountsFile;
}

/** passwords inside — owner-only file in the state directory, removed by `stack.sh down` */
export function writeAccounts(file: AccountsFile): void {
  mkdirSync(path.dirname(accountsFile), { recursive: true, mode: 0o700 });
  writeFileSync(accountsFile, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  chmodSync(accountsFile, 0o600);
}

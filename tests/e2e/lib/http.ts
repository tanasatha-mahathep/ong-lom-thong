import { randomInt } from "node:crypto";
import { type APIRequestContext, type APIResponse, type PlaywrightWorkerArgs, expect } from "@playwright/test";
import type { Account } from "./accounts";
import { target } from "./target";

/** never a real site (RFC 2606) — what a cross-site attacker's page would send */
export const FOREIGN_ORIGIN = "https://attacker.invalid";

/**
 * A distinct client address per simulated browser, from 198.18.0.0/15 (RFC 2544, never routed).
 * In production Railway's edge adds the client IP; the local stack has no proxy, so the tests play that part.
 * Without it better-auth puts every sign-in into one shared bucket (5 a minute for everybody).
 */
export function clientAddress(): string {
  return `198.${randomInt(18, 20)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
}

/** a fresh cookie jar that behaves like a browser tab on the site: same-origin Origin header, own client IP */
export async function newClient(playwright: PlaywrightWorkerArgs["playwright"]): Promise<APIRequestContext> {
  const ip = clientAddress();
  return playwright.request.newContext({
    baseURL: target.baseURL,
    extraHTTPHeaders: { origin: target.origin, "x-forwarded-for": ip, "x-real-ip": ip },
  });
}

export async function signIn(api: APIRequestContext, account: Pick<Account, "email" | "password">) {
  return api.post("/api/auth/sign-in/email", { data: { email: account.email, password: account.password } });
}

/** error body of this api (spec §5): `{ error, field? }` and nothing else */
export interface ApiError {
  error: string;
  field?: string;
}

const THAI = /[\u0E00-\u0E7F]/;
/** what a leaked stack trace or internal path looks like in a response body */
const LEAK = [
  /\n\s+at\s/,
  /\bat\s+\S+\s+\(.*:\d+:\d+\)/,
  /node:internal/,
  /node_modules/,
  /\/app\/dist\//,
  /\.[cm]?[jt]s:\d+/,
];

export function expectNoLeak(body: string): void {
  for (const pattern of LEAK) expect(body, `response body leaks internals (${String(pattern)})`).not.toMatch(pattern);
}

/**
 * status + JSON error shape + no stack trace; returns the parsed error for further checks.
 * `extra` = keys a route documents on top of `error`/`field` (e.g. `existing_id` on a duplicate customer).
 */
export async function expectApiError(res: APIResponse, status: number, extra: string[] = []): Promise<ApiError> {
  const text = await res.text();
  expect(res.status(), `${res.url()} → ${text.slice(0, 200)}`).toBe(status);
  expect(res.headers()["content-type"]).toContain("application/json");
  expectNoLeak(text);
  const body = JSON.parse(text) as ApiError;
  const allowed = new Set(["error", "field", ...extra]);
  expect(Object.keys(body).filter((key) => !allowed.has(key))).toEqual([]);
  expect(typeof body.error).toBe("string");
  return body;
}

/** validation errors name the field and explain in Thai (spec §5) */
export async function expectFieldError(
  res: APIResponse,
  status: number,
  field: string,
  extra: string[] = [],
): Promise<ApiError> {
  const body = await expectApiError(res, status, extra);
  expect(body.field).toBe(field);
  expect(body.error, "message is shown to the counter staff as-is — must be Thai").toMatch(THAI);
  return body;
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "../../lib/fixtures";
import { syntheticNationalId, thaiName } from "../../lib/synthetic";
import { stackScript, target } from "../../lib/target";

const run = promisify(execFile);

/**
 * the api container's stdout of the last 10 minutes, without compose's "api-1 |" prefix — relative to the Docker
 * daemon's clock, so a host/VM clock skew cannot hide lines; other tests' lines are in it too, which only makes
 * the "no customer data" checks stricter
 */
async function apiLog(): Promise<string[]> {
  const { stdout } = await run("bash", [stackScript, "logs", "--no-color", "--no-log-prefix", "--since", "10m", "api"]);
  return stdout.split("\n").filter(Boolean);
}

/**
 * The access log is one line per request — method, path without the query, status, time — and nothing a customer
 * typed or carries (PDPA · R13 · ASVS V7.1.1): no search terms, no national ID, no cookie. Read from the real
 * container, so it also proves the middleware sits in front of every route of the production build.
 */
test("the access log names each request but no customer data (PDPA · R13)", async ({ signedIn }) => {
  test.skip(!target.isLocalStack, "reads the api container's log — local stack only");
  const staff = await signedIn("staff");

  const nationalId = syntheticNationalId();
  const name = thaiName("บันทึก");
  const created = await staff.post("/api/customers", { multipart: { national_id: nationalId, name_th: name } });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  // what a counter search sends: the whole ID, and the name, in the query string
  expect((await staff.get(`/api/customers?q=${nationalId}`)).status()).toBe(200);
  expect((await staff.get(`/api/customers?q=${encodeURIComponent(name)}`)).status()).toBe(200);
  expect((await staff.get(`/api/customers/${id}`)).status()).toBe(200);
  const cookie = (await staff.storageState()).cookies[0]?.value ?? "";

  const line = (method: string, path: string, status: number) => new RegExp(`^${method} ${path} ${status} \\d+ms$`);
  await expect
    .poll(async () => (await apiLog()).filter((l) => line("GET", `/api/customers/${id}`, 200).test(l)).length)
    .toBe(1);
  const log = await apiLog();
  expect(log.filter((l) => line("POST", "/api/customers", 201).test(l)).length).toBeGreaterThanOrEqual(1);
  expect(log.filter((l) => line("GET", "/api/customers", 200).test(l)).length).toBeGreaterThanOrEqual(2);

  const text = log.join("\n");
  expect(text).not.toContain(nationalId);
  expect(text).not.toContain(name);
  expect(text).not.toContain(encodeURIComponent(name));
  expect(text).not.toMatch(/\?q=|\d{13}/); // no query strings, no ID-length digit runs at all
  expect(cookie.length).toBeGreaterThan(0);
  expect(text).not.toContain(cookie);
  expect(text).not.toMatch(/session_token|authorization|cookie/i);
});

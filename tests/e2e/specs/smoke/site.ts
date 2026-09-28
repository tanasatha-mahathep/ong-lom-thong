import { type APIResponse, test as base } from "@playwright/test";
import { FOREIGN_ORIGIN } from "../../lib/http";

/**
 * The only way smoke specs talk to the site. Smoke also runs against staging and production after every
 * Railway deploy, so it must never write: GET/HEAD, plus unsafe methods sent the way an attacker's page would
 * (foreign Origin, no session) — refused before any handler runs, and without a session even if they were not.
 */
interface ReadOnlySite {
  get(path: string, headers?: Record<string, string>): Promise<APIResponse>;
  head(path: string): Promise<APIResponse>;
  /** a cross-site write attempt — the server must answer 403 without touching data */
  foreignWrite(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, origin?: string | null): Promise<APIResponse>;
}

export const test = base.extend<{ site: ReadOnlySite }>({
  site: async ({ request }, use) => {
    await use({
      get: (path, headers) => request.get(path, { headers, maxRedirects: 0 }),
      head: (path) => request.head(path, { maxRedirects: 0 }),
      foreignWrite: (method, path, origin = FOREIGN_ORIGIN) =>
        request.fetch(path, {
          method,
          headers: origin === null ? {} : { origin },
          data: { probe: "smoke" },
          maxRedirects: 0,
        }),
    });
  },
});

export { expect } from "@playwright/test";

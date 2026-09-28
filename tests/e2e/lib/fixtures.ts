import { type APIRequestContext, test as base, expect } from "@playwright/test";
import { type Account, type AccountKey, readAccounts } from "./accounts";
import { newClient, signIn } from "./http";
import { target } from "./target";

interface ApiFixtures {
  /** refuses to run against anything but a disposable environment — the api project writes data */
  writeGuard: void;
  accounts: Record<AccountKey, Account>;
  /** a fresh browser-like client (own cookie jar, same-origin Origin, own client IP), not signed in */
  anonymous: () => Promise<APIRequestContext>;
  /** a fresh client signed in as that account through the real sign-in endpoint */
  signedIn: (key: AccountKey) => Promise<APIRequestContext>;
}

export const test = base.extend<ApiFixtures>({
  writeGuard: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their first argument
    async ({}, use) => {
      if (!target.allowWrites) {
        throw new Error(
          `the api project creates users, customers and prices — refusing to write to ${target.baseURL}. ` +
            "Run it against the local stack, or set E2E_ALLOW_WRITES=1 for a disposable environment.",
        );
      }
      await use();
    },
    { auto: true },
  ],

  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their first argument
  accounts: async ({}, use) => {
    await use(readAccounts().accounts);
  },

  anonymous: async ({ playwright }, use) => {
    const clients: APIRequestContext[] = [];
    await use(async () => {
      const client = await newClient(playwright);
      clients.push(client);
      return client;
    });
    await Promise.all(clients.map((c) => c.dispose()));
  },

  signedIn: async ({ anonymous, accounts }, use) => {
    await use(async (key) => {
      const client = await anonymous();
      const res = await signIn(client, accounts[key]);
      expect(res.status(), `sign in as ${key}: ${await res.text()}`).toBe(200);
      return client;
    });
  },
});

export { expect };

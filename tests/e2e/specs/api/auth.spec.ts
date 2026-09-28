import { type AccountKey } from "../../lib/accounts";
import { expect, test } from "../../lib/fixtures";
import { FOREIGN_ORIGIN, expectApiError, signIn } from "../../lib/http";
import { target } from "../../lib/target";

interface Me {
  user: { id: string; name: string; email: string };
  role: string;
  branch: { id: string; code: string; name: string } | null;
  branches: { id: string; code: string; name: string }[];
  can_view_all: boolean;
}

// better-auth prefixes the cookie with __Secure- when NODE_ENV=production (useSecureCookies)
const SESSION_COOKIE = "__Secure-better-auth.session_token";

test.describe("sign-in, session and sign-out — spec §10 · OWASP ASVS V3", () => {
  for (const key of ["staff", "manager", "accounting", "admin"] satisfies AccountKey[]) {
    test(`${key} signs in and gets a hardened session cookie`, async ({ anonymous, accounts }) => {
      const client = await anonymous();
      const account = accounts[key];

      const res = await signIn(client, account);
      expect(res.status()).toBe(200);
      const setCookie = res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie");
      const session = setCookie.find((h) => h.value.startsWith(`${SESSION_COOKIE}=`));
      expect(session, `Set-Cookie: ${setCookie.map((h) => h.value).join(" | ")}`).toBeDefined();
      // spec §10: HttpOnly; Secure; SameSite=Lax — scoped to the whole origin, a 12-hour shift
      const attributes = (session?.value ?? "").split(";").map((part) => part.trim().toLowerCase());
      expect(attributes).toEqual(
        expect.arrayContaining(["httponly", "secure", "samesite=lax", "path=/", `max-age=${12 * 60 * 60}`]),
      );

      const me = await client.get("/api/me");
      expect(me.status()).toBe(200);
      const body = (await me.json()) as Me;
      expect(body.role).toBe(key);
      expect(body.user.email).toBe(account.email);
      expect(body.branch?.code).toBe("00000");
    });
  }

  test("wrong password and unknown e-mail look the same — no account enumeration (ASVS V2.2)", async ({
    anonymous,
    accounts,
  }) => {
    const client = await anonymous();
    const wrongPassword = await signIn(client, { email: accounts.staff.email, password: "not-the-password-0" });
    const unknownUser = await signIn(client, { email: `nobody-${Date.now()}@ong.test`, password: "whatever-000" });
    expect(wrongPassword.status()).toBe(401);
    expect(unknownUser.status()).toBe(401);
    expect(await unknownUser.json()).toEqual(await wrongPassword.json());
    expect(wrongPassword.headers()["set-cookie"]).toBeUndefined();
  });

  test("sign-out ends the session on the server, not just in the browser", async ({ signedIn }) => {
    const client = await signedIn("staff");
    const cookies = (await client.storageState()).cookies.filter((c) => c.name === SESSION_COOKIE);
    expect(cookies).toHaveLength(1);

    // the better-auth browser client posts an empty JSON body
    expect((await client.post("/api/auth/sign-out", { data: {} })).status()).toBe(200);
    expect((await client.get("/api/me")).status()).toBe(401);

    // replaying the old cookie after sign-out must not work either
    const replay = await client.get("/api/me", {
      headers: { cookie: `${SESSION_COOKIE}=${cookies[0]?.value ?? ""}` },
    });
    await expectApiError(replay, 401);
  });

  test("sign-in is throttled per client after 5 attempts a minute (ASVS V2.2.1)", async ({ anonymous, accounts }) => {
    const attacker = await anonymous();
    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await signIn(attacker, { email: accounts.staff.email, password: `guess-${attempt}-0000` });
      expect(res.status(), `attempt ${attempt}`).toBe(401);
    }
    const blocked = await signIn(attacker, accounts.staff);
    expect(blocked.status(), "even the right password is refused once throttled").toBe(429);

    // the limit is per client: the real user at the counter can still sign in
    const counter = await anonymous();
    expect((await signIn(counter, accounts.staff)).status()).toBe(200);
  });

  test("a sign-in posted from another site is refused before it reaches auth (CSRF)", async ({
    anonymous,
    accounts,
  }) => {
    const client = await anonymous();
    const res = await client.post("/api/auth/sign-in/email", {
      headers: { origin: FOREIGN_ORIGIN },
      data: { email: accounts.staff.email, password: accounts.staff.password },
    });
    expect((await expectApiError(res, 403)).error).toBe("forbidden origin");
    expect(res.headers()["set-cookie"]).toBeUndefined();
    expect(target.origin).not.toBe(FOREIGN_ORIGIN);
  });
});

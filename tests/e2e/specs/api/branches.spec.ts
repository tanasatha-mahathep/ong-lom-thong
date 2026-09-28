import { expect, test } from "../../lib/fixtures";
import { expectApiError } from "../../lib/http";
import { syntheticNationalId, thaiName } from "../../lib/synthetic";

interface BranchRef {
  id: string;
  code: string;
  name: string;
}
interface Me {
  role: string;
  branch: BranchRef | null;
  branches: BranchRef[];
  can_view_all: boolean;
}

/**
 * Branch scoping fails closed (CLAUDE.md rule 4 · spec §10): no right = empty or 404, never "every branch".
 * Branch-owned data does not exist in the api yet (bills come with /buy), so the scoped surface today is the
 * session's working branch (POST /api/me/branch) and the branch list; customers are shop-wide by design.
 */
test.describe("branch scoping — fail closed (rule 4 · spec §10)", () => {
  test("a user of another branch cannot enter branch 00000 — 404, same as a branch that does not exist", async ({
    signedIn,
  }) => {
    const staff = await signedIn("staff");
    const hq = ((await (await staff.get("/api/me")).json()) as Me).branch;
    expect(hq?.code).toBe("00000");

    const other = await signedIn("otherBranch");
    const before = (await (await other.get("/api/me")).json()) as Me;
    expect(before.branch?.code).toBe("00001");
    expect(before.branches.map((b) => b.code)).toEqual(["00001"]);
    expect(before.can_view_all).toBe(false);

    const intoHq = await other.post("/api/me/branch", { data: { branch_id: hq?.id } });
    const intoNowhere = await other.post("/api/me/branch", {
      data: { branch_id: "00000000-0000-4000-8000-000000000000" },
    });
    const refused = await expectApiError(intoHq, 404);
    expect(refused).toEqual({ error: "not found", field: "branch_id" });
    // no existence oracle: a real branch without rights answers exactly like a made-up id
    expect(await expectApiError(intoNowhere, 404)).toEqual(refused);

    const after = (await (await other.get("/api/me")).json()) as Me;
    expect(after.branch?.code).toBe("00001");
  });

  test("an account without any branch is refused, not shown everything", async ({ signedIn }) => {
    const staff = await signedIn("staff");
    const created = await staff.post("/api/customers", {
      multipart: { national_id: syntheticNationalId(), name_th: thaiName("สาขา") },
    });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const nobody = await signedIn("noBranch");
    const me = (await (await nobody.get("/api/me")).json()) as Me;
    expect(me.branch).toBeNull();
    expect(me.branches).toEqual([]);

    await expectApiError(await nobody.get("/api/customers"), 403);
    await expectApiError(await nobody.get(`/api/customers/${id}`), 403);
    await expectApiError(await nobody.get(`/api/customers/${id}/photo`), 403);
    const write = await nobody.post("/api/customers", {
      multipart: { national_id: syntheticNationalId(), name_th: thaiName("ไม่มีสาขา") },
    });
    await expectApiError(write, 403);
  });

  test("customers are shop-wide by design (spec §4: no branch_id) — any branch sees them", async ({ signedIn }) => {
    const staff = await signedIn("staff");
    const created = await staff.post("/api/customers", {
      multipart: { national_id: syntheticNationalId(), name_th: thaiName("ใช้ร่วม") },
    });
    const { id } = (await created.json()) as { id: string };

    const other = await signedIn("otherBranch");
    expect((await other.get(`/api/customers/${id}`)).status()).toBe(200);
  });

  test("view-all sees every active branch and may work in any of them", async ({ signedIn }) => {
    const admin = await signedIn("admin");
    const me = (await (await admin.get("/api/me")).json()) as Me;
    expect(me.can_view_all).toBe(true);
    expect(me.branches.map((b) => b.code)).toEqual(["00000", "00001", "00002"]);

    const branch2 = me.branches.find((b) => b.code === "00001");
    const res = await admin.post("/api/me/branch", { data: { branch_id: branch2?.id } });
    expect(res.status()).toBe(200);
    expect(((await (await admin.get("/api/me")).json()) as Me).branch?.code).toBe("00001");
  });
});

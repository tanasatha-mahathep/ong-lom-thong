import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../../lib/fixtures";
import { expectApiError, expectFieldError, expectNoLeak, FOREIGN_ORIGIN } from "../../lib/http";
import { PNG_1X1, syntheticNationalId, thaiName, uniqueToken, withBadCheckDigit } from "../../lib/synthetic";

interface Detail {
  id: string;
  national_id: string;
  name_th: string;
  name_en: string | null;
  card_expire_text: string | null;
  card_status: string;
  mobile: string | null;
  has_photo: boolean;
}
interface ListItem {
  id: string;
  national_id_masked: string;
  name_th: string;
  mobile: string | null;
  card_status: string;
}
interface ListBody {
  items: ListItem[];
  page: number;
  has_more: boolean;
}

/** a full 13-digit run anywhere in a body = an unmasked national ID (R13 · CLAUDE.md rule 7) */
const FULL_ID = /\d{13}/;
/** the card-style mask: first digit and the last three only — "1 XXXX XXXXX 45 8" */
const MASKED = /^\d X{4} X{5} \d{2} \d$/;

/** the 10 text fields in Siam ID order (the photo is field 9) — synthetic values only */
function customerFields(overrides: Record<string, string> = {}) {
  return {
    national_id: syntheticNationalId(),
    name_th: thaiName("ลูกค้า"),
    name_en: "Test Customer",
    birthday_text: "01/01/2530",
    religion: "พุทธ",
    address: "1 ถนนทดสอบ ตำบลทดสอบ อำเภอทดสอบ จังหวัดทดสอบ 99999",
    card_issue_text: "01/01/2565",
    card_expire_text: "31/12/2574",
    mobile: "0800000000",
    phone2: "",
    ...overrides,
  };
}

const png = { name: "card.png", mimeType: "image/png", buffer: PNG_1X1 };

async function createCustomer(client: APIRequestContext, fields: Record<string, string>, withPhoto = false) {
  const res = await client.post("/api/customers", { multipart: withPhoto ? { ...fields, photo: png } : fields });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

test.describe("customers — Siam ID form, masking and private photos (R12 · R13 · spec §5)", () => {
  test("create → list (masked) → detail (full ID) → photo through the api only", async ({ signedIn, anonymous }) => {
    const staff = await signedIn("staff");
    const token = uniqueToken();
    const fields = customerFields({ name_th: `ทดสอบ ลูกค้า ${token}` });
    const nationalId = fields.national_id;

    const id = await test.step("create with a photo (multipart, like the counter's form)", () =>
      createCustomer(staff, fields, true));

    await test.step("the list masks the national ID — no 13-digit run anywhere in the body", async () => {
      const res = await staff.get(`/api/customers?q=${encodeURIComponent(token)}`);
      expect(res.status()).toBe(200);
      const text = await res.text();
      expect(text).not.toMatch(FULL_ID);
      expect(text).not.toContain(nationalId);
      const body = JSON.parse(text) as ListBody;
      expect(body.items).toEqual([
        {
          id,
          national_id_masked: `${nationalId[0]} XXXX XXXXX ${nationalId.slice(10, 12)} ${nationalId[12]}`,
          name_th: fields.name_th,
          mobile: fields.mobile,
          card_status: "ok",
        },
      ]);

      // the unfiltered first page (anyone's customers) has no full ID field and only masked numbers —
      // checked per field: other runs' names are free text, so a body-wide digit regex would be guesswork
      const firstPage = (await (await staff.get("/api/customers")).json()) as ListBody;
      for (const item of firstPage.items) {
        expect(Object.keys(item).sort()).toEqual(["card_status", "id", "mobile", "name_th", "national_id_masked"]);
        expect(item.national_id_masked).toMatch(MASKED);
      }
    });

    await test.step("the customer's own page shows the full ID and is not cached", async () => {
      const res = await staff.get(`/api/customers/${id}`);
      expect(res.status()).toBe(200);
      expect(res.headers()["cache-control"]).toBe("no-store");
      const text = await res.text();
      const body = JSON.parse(text) as Detail;
      expect(body).toMatchObject({ id, national_id: nationalId, name_th: fields.name_th, has_photo: true });
      // the object store stays invisible: no bucket URL, no object key
      expect(text).not.toMatch(/https?:\/\/|photos\/|X-Amz-/i);
    });

    await test.step("the photo streams from the private bucket through the api", async () => {
      const res = await staff.get(`/api/customers/${id}/photo`);
      expect(res.status()).toBe(200);
      expect(res.headers()).toMatchObject({
        "content-type": "image/png",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-disposition": "inline",
      });
      expect(Buffer.compare(await res.body(), PNG_1X1)).toBe(0);
    });

    await test.step("without a session there is no photo and no customer", async () => {
      const stranger = await anonymous();
      await expectApiError(await stranger.get(`/api/customers/${id}/photo`), 401);
      await expectApiError(await stranger.get(`/api/customers/${id}`), 401);
    });
  });

  test("validation names the field and explains in Thai", async ({ signedIn }) => {
    const staff = await signedIn("staff");
    const post = (fields: Record<string, string>) => staff.post("/api/customers", { multipart: fields });

    const badCheckDigit = customerFields();
    badCheckDigit.national_id = withBadCheckDigit(badCheckDigit.national_id);
    const idError = await expectFieldError(await post(badCheckDigit), 400, "national_id");
    expect(idError.error).toContain("เลขบัตรประชาชน");

    await expectFieldError(await post(customerFields({ national_id: "12345" })), 400, "national_id");
    await expectFieldError(await post(customerFields({ name_th: "   " })), 400, "name_th");
    await expectFieldError(await post(customerFields({ address: "ก".repeat(1001) })), 400, "address");

    const notAnImage = { name: "card.jpg", mimeType: "image/jpeg", buffer: Buffer.from("<svg onload=alert(1)>") };
    const res = await staff.post("/api/customers", { multipart: { ...customerFields(), photo: notAnImage } });
    await expectFieldError(res, 400, "photo");

    await expectFieldError(await staff.get("/api/customers?q=ก"), 400, "q");
    await expectApiError(await staff.get("/api/customers?page=0"), 400);
  });

  test("JSON instead of the multipart form is refused with 415", async ({ signedIn }) => {
    const staff = await signedIn("staff");
    const res = await staff.post("/api/customers", { data: customerFields() });
    await expectApiError(res, 415);
  });

  test("the same national ID twice is a 409 that points at the existing customer", async ({ signedIn }) => {
    const staff = await signedIn("staff");
    const fields = customerFields();
    const id = await createCustomer(staff, fields);

    // typed the way it is printed on the card — still the same person
    const n = fields.national_id;
    const spaced = `${n[0]} ${n.slice(1, 5)} ${n.slice(5, 10)} ${n.slice(10, 12)} ${n[12]}`;
    const res = await staff.post("/api/customers", {
      multipart: customerFields({ national_id: spaced, name_th: thaiName("ซ้ำ") }),
    });
    const body = await expectFieldError(res, 409, "national_id", ["existing_id"]);
    expect((body as { existing_id?: string }).existing_id).toBe(id);
  });

  test("CSRF: a signed-in browser posting from another site is refused", async ({ signedIn }) => {
    const staff = await signedIn("staff");
    const fields = customerFields();
    const res = await staff.post("/api/customers", { headers: { origin: FOREIGN_ORIGIN }, multipart: fields });
    expect((await expectApiError(res, 403)).error).toBe("forbidden origin");

    // and nothing was created behind the refusal
    const search = await staff.get(`/api/customers?q=${encodeURIComponent(fields.name_th)}`);
    expect(((await search.json()) as ListBody).items).toEqual([]);
  });

  test("malformed ids are a plain 404, never a crash", async ({ signedIn }) => {
    const staff = await signedIn("staff");
    for (const id of ["not-a-uuid", "00000000-0000-4000-8000-000000000000", "%E0%A4%A", "' OR 1=1 --"]) {
      const res = await staff.get(`/api/customers/${encodeURIComponent(id)}`);
      expect(res.status(), id).toBe(404);
      expectNoLeak(await res.text());
    }
  });
});

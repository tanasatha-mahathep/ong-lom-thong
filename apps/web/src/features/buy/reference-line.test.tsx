import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";
import { CUSTOMER_OK, METALS, fakeCustomerSearch, fakeQuote } from "@/test/buy-api";
import type { QuoteBody } from "./types";

const REFERENCE = {
  source: "classic.goldtraders.or.th",
  announced_at: "2026-09-29T09:31:00+07:00",
  round: 2,
  bar_buy: "68050.00",
  bar_sell: "68250.00",
  ornament_buy: "66683.52",
  ornament_sell: "69050.00",
  fetched_at: "2026-09-29T02:35:00.000Z",
  stale: false,
};

function open(reference: () => Response) {
  const api = fakeApi({
    "GET /api/me": () => json(makeMe("staff")),
    "GET /api/gold-price/today": () => json(GOLD_PRICE),
    "GET /api/gold-price/reference": reference,
    "GET /api/metals": () => json(METALS),
    "GET /api/customers": ({ path }) => fakeCustomerSearch(path, [CUSTOMER_OK]),
    "POST /api/buy/quote": ({ body }) => json(fakeQuote(body as QuoteBody, [CUSTOMER_OK])),
  });
  renderApp("/buy");
  return api;
}

const referenceNote = () =>
  waitFor(() => {
    const note = screen.getAllByRole("note").find((n) => n.textContent?.includes("ราคาสมาคม (อ้างอิง)"));
    expect(note).toBeDefined();
    return note as HTMLElement;
  });

describe("/buy — ราคาสมาคม (อ้างอิง)", () => {
  it("แสดงอ่านอย่างเดียว แยกจากราคาของบิล · ไม่มีปุ่ม/ลิงก์ (ไม่เพิ่มจุดโฟกัสในบิล) · ไม่ส่งเข้า quote", async () => {
    const api = open(() => json(REFERENCE));
    const note = await referenceNote();
    expect(note).toHaveTextContent("68,250");
    expect(note).toHaveTextContent("ครั้งที่ 2");
    expect(within(note).queryByRole("button")).not.toBeInTheDocument();
    expect(within(note).queryByRole("link")).not.toBeInTheDocument();
    // ราคาในหัวบิลยังเป็นราคาของร้าน (quote จากเซิร์ฟเวอร์) — ไม่มีราคาสมาคมในคำขอ quote
    await waitFor(() => expect(api.callsTo("POST", "/api/buy/quote")).not.toHaveLength(0));
    for (const call of api.callsTo("POST", "/api/buy/quote")) expect(JSON.stringify(call.body)).not.toContain("68250");
  });

  it("stale → เตือนว่าอาจไม่ใช่ประกาศล่าสุด", async () => {
    open(() => json({ ...REFERENCE, stale: true }));
    expect(await referenceNote()).toHaveTextContent("อาจไม่ใช่ประกาศล่าสุดของวันนี้");
  });

  it("503 → 'ดึงราคาอ้างอิงไม่ได้' ไม่มีตัวเลข", async () => {
    open(() => json({ error: "ดึงราคาอ้างอิงไม่ได้", reason: "unavailable" }, 503));
    const note = await waitFor(() => {
      const n = screen.getAllByRole("note").find((x) => x.textContent?.includes("ดึงราคาอ้างอิงไม่ได้"));
      expect(n).toBeDefined();
      return n as HTMLElement;
    });
    expect(note).not.toHaveTextContent("68,250");
  });
});

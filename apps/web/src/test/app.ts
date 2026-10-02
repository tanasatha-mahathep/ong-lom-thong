import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { vi } from "vitest";
import type { Branch, Me, Role } from "@/lib/queries";
import { createAppRouter } from "@/router";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const BRANCH_HQ: Branch = { id: "b-00000", code: "00000", name: "สำนักงานใหญ่ (สาขา 1)" };
export const BRANCH_2: Branch = { id: "b-00001", code: "00001", name: "สาขา 2" };

export function makeMe(role: Role, branches: Branch[] = [BRANCH_HQ]): Me {
  return {
    user: { id: `u-${role}`, name: `ทดสอบ ${role}`, email: `${role}@ong.test` },
    role,
    branch: branches[0] ?? null,
    branches,
    can_view_all: false,
  };
}

export const GOLD_PRICE = {
  date: "2026-09-28",
  bar_sell: "67850.00",
  bar_buy: "67650.00",
  jewelry_buy: "64268",
  // เงินตั้งราคาแล้ว · แพลตตินั่มยังไม่ได้ตั้ง (รับซื้อไม่ได้) — ครบทั้งสองสถานะในชุดเดียว
  silver_per_g: "45.00",
  platinum_per_g: null,
  diff: "200.00",
  source: "central",
};

interface ApiCall {
  method: string;
  path: string;
  body: unknown;
}
type Handler = (call: ApiCall) => Response | Promise<Response>;

/**
 * แทน fetch ด้วย API ปลอม — key = "METHOD /api/path" · ไม่มี handler = 404
 * key ที่มี query string ต้องตรงทั้ง URL · ไม่ตรง = ใช้ key ที่ไม่มี query (อ่าน query จาก `call.path` เอง)
 */
export function fakeApi(routes: Record<string, Handler>) {
  const calls: ApiCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
      const call = { method: init?.method ?? "GET", path, body };
      calls.push(call);
      const handler = routes[`${call.method} ${path}`] ?? routes[`${call.method} ${path.split("?")[0] ?? path}`];
      return Promise.resolve(handler ? handler(call) : json({ error: "not found" }, 404));
    }),
  );
  return {
    calls,
    /** path ไม่มี "?" = นับทุก query ของ path นั้น */
    callsTo: (method: string, path: string) =>
      calls.filter(
        (c) => c.method === method && (c.path === path || (!path.includes("?") && c.path.startsWith(`${path}?`))),
      ),
  };
}

/** แอปจริงทั้งก้อน (router + QueryClient ใหม่) บน memory history */
export function renderApp(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(createElement(RouterProvider, { router }));
  return router;
}

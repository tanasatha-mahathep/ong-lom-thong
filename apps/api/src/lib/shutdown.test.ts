import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { closeHttpServer, createShutdown } from "./shutdown";

function harness(timeoutMs = 1_000) {
  const exits: number[] = [];
  const lines: string[] = [];
  const log = { log: (m: string) => lines.push(m), error: (m: string) => lines.push(`ERR ${m}`) };
  const shutdown = createShutdown({ timeoutMs, exit: (code) => exits.push(code), log });
  return { shutdown, exits, lines };
}

describe("createShutdown — ปิดตามลำดับ stop → drain → close แล้ว exit 0", () => {
  it("ทำทุก phase ตามลำดับ · งานที่พังไม่หยุดงานถัดไป · exit 0 ครั้งเดียว", async () => {
    const { shutdown, exits, lines } = harness();
    const order: string[] = [];
    shutdown.add("close", "postgres", () => order.push("close:postgres"));
    shutdown.add("drain", "pdf tasks", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("drain:pdf");
    });
    shutdown.add("stop", "http", async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push("stop:http");
    });
    shutdown.add("stop", "retry loop", () => {
      order.push("stop:retry");
      throw new Error("boom");
    });

    const first = shutdown.run("SIGTERM");
    expect(shutdown.run("SIGTERM")).toBe(first); // เรียกซ้ำ = งานเดิม
    await first;
    expect(order).toEqual(["stop:retry", "stop:http", "drain:pdf", "close:postgres"]);
    expect(exits).toEqual([0]);
    expect(lines).toContain("ERR [shutdown] retry loop failed:");
  });

  it("งานค้างเกินเวลา = exit 1 (ก่อน Railway ส่ง SIGKILL)", async () => {
    const { shutdown, exits } = harness(50);
    shutdown.add("stop", "stuck request", () => new Promise(() => {}));
    void shutdown.run("SIGTERM");
    await new Promise((r) => setTimeout(r, 120));
    expect(exits).toEqual([1]);
  });

  it("SIGTERM / SIGINT เริ่มปิด · สัญญาณซ้ำระหว่างปิด = exit 1 ทันที", async () => {
    const { shutdown, exits } = harness();
    const proc = new EventEmitter();
    let release = () => {};
    shutdown.add("stop", "slow", () => new Promise<void>((r) => (release = r)));
    shutdown.listen(proc);
    proc.emit("SIGINT");
    proc.emit("SIGTERM");
    expect(exits).toEqual([1]);
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(exits).toEqual([1, 0]);
  });
});

describe("closeHttpServer — หยุดรับ connection ใหม่ แต่ request ที่ค้างอยู่ทำจนจบ", () => {
  it("request ที่กำลังบันทึกได้ 200 · connection ใหม่ถูกปฏิเสธ · resolve เมื่อทุก connection ปิด", async () => {
    let entered = () => {};
    const inFlight = new Promise<void>((r) => (entered = r));
    let finish = () => {};
    const gate = new Promise<void>((r) => (finish = r));
    const app = new Hono()
      .post("/slow", async (c) => {
        entered();
        await gate;
        return c.json({ saved: true });
      })
      .get("/fast", (c) => c.text("ok"));

    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
    await new Promise<void>((r) => (server.listening ? r() : server.once("listening", () => r())));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const slow = fetch(`${base}/slow`, { method: "POST" });
    await inFlight;
    let closed = false;
    const closing = closeHttpServer(server).then(() => (closed = true));

    await expect(fetch(`${base}/fast`)).rejects.toThrow();
    expect(closed).toBe(false);

    finish();
    const res = await slow;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: true });
    await closing;
    expect(closed).toBe(true);
    expect(server.listening).toBe(false);
  });
});

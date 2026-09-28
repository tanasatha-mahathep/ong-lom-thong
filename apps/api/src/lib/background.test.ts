import { describe, expect, it } from "vitest";
import { createBackgroundTasks, createManualTasks } from "./background";

const quiet = { error: () => {} };

/** งานที่ค้างจนกว่าจะปล่อย — ใช้วัดว่ามีกี่งานวิ่งพร้อมกัน */
function gate() {
  let open = () => {};
  const done = new Promise<void>((resolve) => (open = resolve));
  return { done, open };
}

describe("createBackgroundTasks — คิวงานเบื้องหลัง (B2)", () => {
  it("ทำพร้อมกันไม่เกิน 2 งาน ที่เหลือรอคิวตามลำดับ", async () => {
    const tasks = createBackgroundTasks({ log: quiet });
    const gates = Array.from({ length: 5 }, gate);
    const started: number[] = [];
    let running = 0;
    let peak = 0;
    gates.forEach((g, i) =>
      tasks.run(`job ${i}`, async () => {
        started.push(i);
        running++;
        peak = Math.max(peak, running);
        await g.done;
        running--;
      }),
    );
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    for (const g of gates) g.open();
    await tasks.idle();
    expect(started).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
  });

  it("key ซ้ำกับงานที่รอ/กำลังทำ = ไม่รับ · จบแล้วรับใหม่ได้ · งานที่ล้มไม่ทำให้คิวหยุด", async () => {
    const tasks = createBackgroundTasks({ log: quiet });
    const g = gate();
    let runs = 0;
    expect(tasks.run("a", () => g.done.then(() => runs++), "bill-1")).toBe(true);
    expect(tasks.run("a again", () => Promise.resolve(runs++), "bill-1")).toBe(false);
    expect(tasks.run("boom", () => Promise.reject(new Error("x")), "bill-2")).toBe(true);
    g.open();
    await tasks.idle();
    expect(runs).toBe(1);
    expect(tasks.run("a later", () => Promise.resolve(runs++), "bill-1")).toBe(true);
    await tasks.idle();
    expect(runs).toBe(2);
    expect(tasks.size()).toBe(0);
  });

  it("โหมดเทสต์ (manual): เก็บไว้จน flush · dedupe เหมือนกัน", async () => {
    const tasks = createManualTasks(quiet);
    let runs = 0;
    tasks.run("x", () => Promise.resolve(runs++), "k");
    expect(tasks.run("x", () => Promise.resolve(runs++), "k")).toBe(false);
    expect(runs).toBe(0);
    await tasks.flush();
    expect(runs).toBe(1);
  });
});

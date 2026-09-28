/**
 * งานเบื้องหลังที่ request ไม่ต้องรอ (สร้าง PDF หลังบันทึกบิล) — error ของงานถูกจับและ log ที่นี่ ไม่หลุดเป็น
 * unhandled rejection · idle() ให้เทสต์และตอนปิดเครื่องรอจนงานที่ค้างเสร็จ
 */
export interface BackgroundTasks {
  run(name: string, task: () => Promise<unknown>): void;
  idle(): Promise<void>;
}

type Log = Pick<Console, "error">;

async function settle(name: string, task: () => Promise<unknown>, log: Log): Promise<void> {
  try {
    await task();
  } catch (e) {
    log.error(`[background] ${name} failed:`, e instanceof Error ? e.message : e);
  }
}

/** production — เริ่มงานทันทีแบบไม่รอ */
export function createBackgroundTasks(log: Log = console): BackgroundTasks {
  const running = new Set<Promise<void>>();
  return {
    run(name, task) {
      const job: Promise<void> = settle(name, task, log).finally(() => running.delete(job));
      running.add(job);
    },
    async idle() {
      while (running.size > 0) await Promise.all([...running]);
    },
  };
}

/**
 * เทสต์ — เก็บงานไว้จนกว่าจะสั่ง flush() บิลที่เพิ่งบันทึกจึงยัง pending ให้ตรวจได้แน่นอน
 * idle() = flush() เพื่อให้ปิดเทสต์ได้โดยไม่มีงานค้างวิ่งหลัง database ถูกลบ
 */
export function createManualTasks(log: Log = console): BackgroundTasks & { flush(): Promise<void>; size(): number } {
  const queue: { name: string; task: () => Promise<unknown> }[] = [];
  const flush = async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (next) await settle(next.name, next.task, log);
    }
  };
  return {
    run(name, task) {
      queue.push({ name, task });
    },
    idle: flush,
    flush,
    size: () => queue.length,
  };
}

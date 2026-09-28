/**
 * งานเบื้องหลังที่ request ไม่ต้องรอ (สร้าง PDF หลังบันทึกบิล · retry) — error ของงานถูกจับและ log ที่นี่
 * ไม่หลุดเป็น unhandled rejection · idle() ให้เทสต์และตอนปิดเครื่องรอจนงานที่ค้างเสร็จ
 */
export interface BackgroundTasks {
  /** key ซ้ำกับงานที่รอ/กำลังทำ = ไม่รับ (คืน false) — บิลเดียวไม่เข้าคิวซ้ำ */
  run(name: string, task: () => Promise<unknown>, key?: string): boolean;
  idle(): Promise<void>;
}

type Log = Pick<Console, "error">;
interface Job {
  name: string;
  task: () => Promise<unknown>;
  key?: string;
}

async function settle(job: Job, log: Log): Promise<void> {
  try {
    await job.task();
  } catch (e) {
    log.error(`[background] ${job.name} failed:`, e instanceof Error ? e.message : e);
  }
}

/**
 * production — ทำพร้อมกันไม่เกิน concurrency งาน ที่เหลือเข้าคิว (Gotenberg/bucket ช้า ไม่ลากทั้งแอป)
 * ค่าเริ่มต้น 2: ร้าน 3 สาขา บิลไม่กี่ใบต่อนาที — พอสำหรับงานปกติและ retry รอบละ 10 ใบ
 */
export function createBackgroundTasks({
  concurrency = 2,
  log = console,
}: { concurrency?: number; log?: Log } = {}): BackgroundTasks & { size(): number } {
  const queue: Job[] = [];
  const active = new Set<Promise<void>>();
  const keys = new Set<string>();
  let waiters: (() => void)[] = [];

  const pump = () => {
    while (active.size < concurrency && queue.length > 0) {
      const job = queue.shift();
      if (!job) break;
      const running: Promise<void> = settle(job, log).finally(() => {
        active.delete(running);
        if (job.key) keys.delete(job.key);
        pump();
        if (active.size === 0 && queue.length === 0) {
          for (const wake of waiters) wake();
          waiters = [];
        }
      });
      active.add(running);
    }
  };

  return {
    run(name, task, key) {
      if (key !== undefined) {
        if (keys.has(key)) return false;
        keys.add(key);
      }
      queue.push({ name, task, key });
      pump();
      return true;
    },
    idle() {
      if (active.size === 0 && queue.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.push(resolve));
    },
    size: () => active.size + queue.length,
  };
}

/**
 * เทสต์ — เก็บงานไว้จนกว่าจะสั่ง flush() บิลที่เพิ่งบันทึกจึงยัง pending ให้ตรวจได้แน่นอน
 * idle() = flush() เพื่อให้ปิดเทสต์ได้โดยไม่มีงานค้างวิ่งหลัง database ถูกลบ
 */
export function createManualTasks(log: Log = console): BackgroundTasks & { flush(): Promise<void>; size(): number } {
  const queue: Job[] = [];
  const keys = new Set<string>();
  const flush = async () => {
    while (queue.length > 0) {
      const job = queue.shift();
      if (!job) continue;
      await settle(job, log);
      if (job.key) keys.delete(job.key);
    }
  };
  return {
    run(name, task, key) {
      if (key !== undefined) {
        if (keys.has(key)) return false;
        keys.add(key);
      }
      queue.push({ name, task, key });
      return true;
    },
    idle: flush,
    flush,
    size: () => queue.length,
  };
}

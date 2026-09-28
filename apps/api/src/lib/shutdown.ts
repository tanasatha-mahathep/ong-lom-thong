import type { ServerType } from "@hono/node-server";

/**
 * ลำดับการปิด — phase ทำตามลำดับ · งานใน phase เดียวกันทำพร้อมกัน · งานที่พังถูก log แล้วไปต่อ
 *   stop  — หยุดรับ connection ใหม่แล้วรอ request ที่ค้างอยู่ (บันทึกบิล) ให้จบ · หยุด timer/interval
 *   drain — งานเบื้องหลังที่ต้องเสร็จก่อนปิด DB (เช่น สร้าง PDF หลังบันทึกบิล)
 *   close — ปิด pool ของ Postgres
 */
export type ShutdownPhase = "stop" | "drain" | "close";
const PHASES: ShutdownPhase[] = ["stop", "drain", "close"];

export type ShutdownHook = () => unknown;

interface ShutdownOptions {
  /** เกินนี้ = exit 1 ทันที — ต้องน้อยกว่า drainingSeconds ของ Railway (10 วินาที) ก่อนโดน SIGKILL */
  timeoutMs?: number;
  exit?: (code: number) => void;
  log?: Pick<Console, "log" | "error">;
}

/** สิ่งที่ส่งสัญญาณมาได้ — process จริง หรือ EventEmitter ในเทสต์ */
interface SignalSource {
  on(event: NodeJS.Signals, listener: () => void): unknown;
}

/**
 * ปิดเครื่องอย่างนุ่มนวลเมื่อได้ SIGTERM (Railway redeploy · docker stop) หรือ SIGINT (Ctrl-C)
 * ครบทุก phase = exit 0 · เกิน timeoutMs หรือได้สัญญาณซ้ำระหว่างปิด = exit 1
 * timer/งานเบื้องหลังใหม่ลงทะเบียนผ่าน add() ใน index.ts
 */
export function createShutdown({
  timeoutMs = 8_000,
  exit = (code) => process.exit(code),
  log = console,
}: ShutdownOptions = {}) {
  const hooks: Record<ShutdownPhase, { name: string; hook: ShutdownHook }[]> = { stop: [], drain: [], close: [] };
  let running: Promise<void> | null = null;

  const runPhase = (phase: ShutdownPhase) =>
    Promise.all(
      hooks[phase].map(async ({ name, hook }) => {
        try {
          await hook();
        } catch (e) {
          log.error(`[shutdown] ${name} failed:`, e instanceof Error ? e.message : e);
        }
      }),
    );

  function run(reason: string): Promise<void> {
    if (running) return running;
    const started = Date.now();
    log.log(`[shutdown] ${reason} — closing (limit ${timeoutMs} ms)`);
    const deadline = setTimeout(() => {
      log.error(`[shutdown] still busy after ${timeoutMs} ms — forcing exit`);
      exit(1);
    }, timeoutMs);
    running = (async () => {
      for (const phase of PHASES) await runPhase(phase);
      clearTimeout(deadline);
      log.log(`[shutdown] done in ${Date.now() - started} ms`);
      exit(0);
    })();
    return running;
  }

  return {
    add(phase: ShutdownPhase, name: string, hook: ShutdownHook) {
      hooks[phase].push({ name, hook });
    },
    run,
    listen(source: SignalSource = process, signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"]) {
      for (const signal of signals) {
        source.on(signal, () => {
          if (!running) return void run(signal);
          log.error(`[shutdown] ${signal} again — forcing exit`);
          exit(1);
        });
      }
    },
  };
}

export type Shutdown = ReturnType<typeof createShutdown>;

/**
 * หยุดรับ connection ใหม่ แล้วรอ request ที่ค้างอยู่ให้จบ (resolve เมื่อทุก connection ปิด)
 * connection keep-alive ที่ว่างถูกปิดทุก 250 ms · request ที่เข้ามาทาง connection เดิมระหว่างปิดได้ Connection: close
 */
export function closeHttpServer(server: ServerType): Promise<void> {
  return new Promise((resolve) => {
    if (!("closeIdleConnections" in server)) {
      server.close(() => resolve());
      return;
    }
    server.on("request", (_req, res) => {
      if (!res.headersSent) res.setHeader("Connection", "close");
    });
    const sweep = setInterval(() => server.closeIdleConnections(), 250);
    server.close(() => {
      clearInterval(sweep);
      resolve();
    });
    server.closeIdleConnections();
  });
}

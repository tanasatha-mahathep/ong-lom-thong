import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const health = useQuery({
    queryKey: ["healthz"],
    queryFn: async () => {
      const r = await fetch("/api/healthz");
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as { ok: boolean; time: string };
    },
  });

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-bold">ONG หลอมทอง — ระบบใหม่</h1>
      <p className="mt-2 text-sm text-neutral-600">ซื้อเข้าหน้าร้าน + สมาชิก · Vite + TanStack · Railway</p>
      <p className="mt-6 tabular-nums">
        API: {health.isPending ? "…" : health.data?.ok ? `ok (${health.data.time})` : "ไม่ตอบ"}
      </p>
    </main>
  );
}

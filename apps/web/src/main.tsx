// ต้องมาก่อนทุก import — ตั้งค่า zod ก่อน schema ใด ๆ ถูกสร้าง (ดู lib/zod-config.ts)
import "./lib/zod-config";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { i18nReady } from "@/i18n";
import { listenForAppUpdates } from "@/lib/app-update";
import { createAppRouter } from "@/router";
import "./styles.css";

const router = createAppRouter();
listenForAppUpdates();
const root = document.getElementById("root");
if (!root) throw new Error("ไม่พบ #root ใน index.html");

// ภาษาที่จำไว้ (อังกฤษ = โหลด chunk ก่อน) — render ครั้งแรกเป็นภาษาที่เลือกเลย ไม่กะพริบ
void i18nReady.then(() =>
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  ),
);

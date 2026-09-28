// ต้องมาก่อนทุก import — ตั้งค่า zod ก่อน schema ใด ๆ ถูกสร้าง (ดู lib/zod-config.ts)
import "./lib/zod-config";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createAppRouter } from "@/router";
import "./styles.css";

const router = createAppRouter();
const root = document.getElementById("root");
if (!root) throw new Error("ไม่พบ #root ใน index.html");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

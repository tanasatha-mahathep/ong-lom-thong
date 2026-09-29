import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import "./print.css";

/** สำเนาสำหรับพิมพ์ ต่อท้าย <body> นอก #root — print.css ซ่อนทุกอย่างอื่นตอนพิมพ์ */
export function PrintPortal({ children }: { children: ReactNode }) {
  return createPortal(<div className="print-only theme-light">{children}</div>, document.body);
}

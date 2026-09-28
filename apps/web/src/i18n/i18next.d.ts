import "i18next";
import type { resources } from "./resources";

// key ของ t() ถูกตรวจตอน typecheck — พิมพ์ผิด/ลืมเพิ่มใน locale = compile error
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: (typeof resources)["th"];
  }
}

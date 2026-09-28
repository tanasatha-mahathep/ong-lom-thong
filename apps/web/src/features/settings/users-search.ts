import { z } from "zod";
import { ROLES } from "@/lib/queries";

/**
 * ตัวกรองของ /settings/users ใน URL (แชร์ลิงก์/ย้อนกลับได้) — ค่าผิดรูปที่พิมพ์ URL เอง = ไม่กรอง
 * router แปลงค่าใน URL แบบ JSON: ?q=0812 เป็น number · ?active=true เป็น boolean
 */
export const UsersSearchSchema = z.object({
  q: z.coerce.string().trim().max(100).default("").catch(""),
  /** id ของสาขา (สาขาหลักหรือสาขาที่อนุญาต) — API รับเฉพาะ uuid */
  branch: z.uuid().optional().catch(undefined),
  role: z.enum(ROLES).optional().catch(undefined),
  active: z.boolean().optional().catch(undefined),
});
export type UsersSearch = z.infer<typeof UsersSearchSchema>;

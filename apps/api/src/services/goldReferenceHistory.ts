import { type Db, goldReferenceAnnouncement } from "@ong/db";
import { asc, gte } from "drizzle-orm";
import type { CachedGoldReference, GoldReferenceService } from "./goldReference";

/**
 * ประวัติราคาสมาคมค้าทองคำ (สำหรับกราฟ) — ประกาศที่เซิร์ฟเวอร์ดึงได้จริง เก็บใน gold_reference_announcement
 *
 * ไม่มี cron/poller ของตัวเอง: บันทึกตอนที่ GET /api/gold-price/reference ดึงสำเร็จ (cache 5 นาทีต่อ process ของ
 * services/goldReference.ts) — มีคนเปิดหน้าที่เรียก endpoint นั้นอยู่ ประกาศใหม่ก็เข้าประวัติภายในไม่กี่นาที
 * ประกาศที่ถูกประกาศครั้งถัดไปแทนก่อนมีใครเปิดหน้า = ไม่มีในประวัติ (ไม่มีแหล่งย้อนหลังให้เติมทีหลัง)
 * ข้อมูลสาธารณะเหมือนกันทุกสาขา — ไม่ใช่ราคาของร้าน ไม่เข้าสูตรบิล (กฎ 2)
 */

/** จำนวนวันย้อนหลังที่ขอได้ (นับวันนี้ด้วย) */
export const GOLD_HISTORY_DEFAULT_DAYS = 90;
export const GOLD_HISTORY_MAX_DAYS = 366;

export type GoldAnnouncementRow = typeof goldReferenceAnnouncement.$inferSelect;

/**
 * เก็บประกาศหนึ่งครั้ง — ประกาศเดียวกัน (เวลาประกาศ + ครั้งที่) มีอยู่แล้ว = ไม่ทำอะไร (ON CONFLICT DO NOTHING)
 * หลาย instance / หลาย request บันทึกพร้อมกันได้โดยไม่เกิดแถวซ้ำ · ค่าแรกที่เห็นอยู่ถาวร ไม่เขียนทับ
 * เงินเป็น string จาก provider (ตรวจแล้ว 2 ตำแหน่ง) ลง numeric(14,2) ตรง ๆ ไม่ผ่าน float · คืน true เมื่อเพิ่มแถวใหม่
 */
export async function recordGoldAnnouncement(db: Db, value: CachedGoldReference, recordedAt: Date): Promise<boolean> {
  const inserted = await db
    .insert(goldReferenceAnnouncement)
    .values({
      announcedAt: new Date(value.announcedAt),
      round: value.round,
      source: value.source,
      barBuy: value.barBuy,
      barSell: value.barSell,
      ornamentBuy: value.ornamentBuy,
      ornamentSell: value.ornamentSell,
      recordedAt,
    })
    .onConflictDoNothing({ target: [goldReferenceAnnouncement.announcedAt, goldReferenceAnnouncement.round] })
    .returning({ id: goldReferenceAnnouncement.id });
  return inserted.length > 0;
}

/** ประกาศตั้งแต่ `from` (รวมจุดนั้น) เรียงเก่า → ใหม่ · เวลาประกาศเดียวกันเรียงตามครั้งที่ */
export function listGoldAnnouncements(db: Db, from: Date): Promise<GoldAnnouncementRow[]> {
  return db
    .select()
    .from(goldReferenceAnnouncement)
    .where(gte(goldReferenceAnnouncement.announcedAt, from))
    .orderBy(asc(goldReferenceAnnouncement.announcedAt), asc(goldReferenceAnnouncement.round));
}

/**
 * จุดเริ่มของช่วง `days` วันที่นับวันนี้ด้วย — 00:00 น. เวลาไทยของวัน (today − (days − 1))
 * `today` = businessDate() ("YYYY-MM-DD" เวลาไทย) · ไทยไม่มีเวลาออมแสง จึงใช้ +07:00 คงที่ (เหมือน parseGoldAnnouncement)
 */
export function historyStart(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return `${d.toISOString().slice(0, 10)}T00:00:00+07:00`;
}

const BANGKOK_OFFSET_MS = 7 * 60 * 60_000;

/** เวลา → ISO เวลาไทย "YYYY-MM-DDTHH:MM:SS+07:00" — รูปเดียวกับ announced_at ของ GET /reference */
export function bangkokIso(at: Date): string {
  return `${new Date(at.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 19)}+07:00`;
}

/** ประกาศเดียวกันไหม — เทียบเป็นจุดเวลา (ข้อความ ISO ต่างรูปแต่เวลาเดียวกันนับเป็นประกาศเดียว) + ครั้งที่ */
const announcementKey = (v: CachedGoldReference) => `${Date.parse(v.announcedAt)}#${v.round ?? "-"}`;

/**
 * ครอบ GoldReferenceService ให้บันทึกประกาศที่ดึงได้ลงประวัติ — ตัว service เดิมไม่แตะ DB (เทสต์แบบไม่มี DB ได้เหมือนเดิม)
 * - บันทึกเฉพาะผลที่ ok (ดึงจากแหล่งจริงและผ่านการตรวจแล้ว รวม stale) · ปิด/ล้ม/ข้อมูลเสีย (503) ไม่บันทึกอะไร
 * - ประกาศที่บันทึกสำเร็จแล้วใน process นี้ไม่เขียนซ้ำทุก request (DB กันซ้ำข้าม instance อีกชั้น)
 * - บันทึกล้ม = ส่งผลเดิมกลับเหมือนไม่มีประวัติ (ราคาอ้างอิงต้องไม่ล้มเพราะประวัติ) → onError · request ถัดไปลองใหม่
 */
export function withAnnouncementHistory(
  service: GoldReferenceService,
  options: { record: (value: CachedGoldReference) => Promise<unknown>; onError?: (error: unknown) => void },
): GoldReferenceService {
  const { record, onError = () => {} } = options;
  let stored: string | null = null;
  return {
    peek: () => service.peek(),
    async get() {
      const result = await service.get();
      if (result.ok) {
        const key = announcementKey(result.value);
        if (key !== stored) {
          try {
            await record(result.value);
            stored = key;
          } catch (e) {
            onError(e);
          }
        }
      }
      return result;
    },
  };
}

import { PassThrough, Readable } from "node:stream";
import { ZipFile } from "yazl";

/**
 * zip ที่ข้อมูลเดิมได้ byte เดิมทุกครั้ง — ใช้กับ export ส่งบัญชีรายเดือน (spec §9.4) · yazl แบบ STORE (ไม่บีบอัด)
 * - ขนาดและ CRC อยู่ใน local header ทุกไฟล์ ไม่มี data descriptor — เปิดได้ทั้ง Windows · macOS Archive Utility ·
 *   ตัวอ่านแบบ stream (STORE + data descriptor ตัวอ่านหลายตัวอ่านไม่ได้) · ZIP64 อัตโนมัติถ้าเกิน 4 GB / 65,535 ไฟล์
 * - ไม่บีบอัด: PDF บีบอัดภายในอยู่แล้ว และ byte ไม่ขึ้นกับเวอร์ชันของตัวบีบอัด
 * - เวลาไฟล์ = 00:00:00 ของวันที่กำหนด ทุกไฟล์ · สิทธิ์ 0644 · ไม่มี extra field เวลา UTC ของ Info-ZIP
 *   (เวลาแบบ DOS ไม่มีเขตเวลา yazl อ่านจากเวลาท้องถิ่นของเครื่อง — สร้างวันที่ด้วยเวลาท้องถิ่นจึงได้ช่องวัน/เวลาเดียวกัน
 *   ทุกเครื่อง · ค่า UTC ของ extra field จะต่างตาม TZ ของเครื่อง จึงตัดทิ้ง)
 * - ลำดับไฟล์ = ลำดับที่เรียก add() — ผู้เรียกเรียงเอง
 * - add() รอให้ฝั่งอ่านรับไปก่อนเมื่อค้างเกิน buffer (backpressure) — ไม่ถือทั้งไฟล์ zip ไว้ในหน่วยความจำ
 */

/** ไฟล์ธรรมดา rw-r--r-- */
const FILE_MODE = 0o100644;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ฝั่งอ่านเลิกรับแล้ว (ปิดหน้า/ยกเลิกดาวน์โหลด) หรือถูก abort — ไม่ต้องทำต่อ */
export class ZipClosedError extends Error {
  override name = "ZipClosedError";
}

export interface ZipWriter {
  /** เนื้อไฟล์ zip — เป็น body ของ response ได้ทันที (ไหลออกระหว่างที่ add) */
  readonly body: ReadableStream<Uint8Array>;
  /** เพิ่มไฟล์ต่อท้าย — path แบบ a/b.pdf (yazl ปฏิเสธ path เต็มและ ..) */
  add(path: string, bytes: Uint8Array): Promise<void>;
  /** เขียน central directory แล้วปิด — ต้องเรียกหลัง add() ตัวสุดท้าย resolve แล้ว */
  end(): void;
  /**
   * ยกเลิกกลางทาง — ฝั่งอ่านได้ error ไฟล์ขาดท้าย (ไม่มี central directory = เปิดไม่ได้)
   * ไม่มีทางได้ zip ที่ดูครบแต่ขาดไฟล์
   */
  abort(reason: Error): void;
}

/** วันที่ "YYYY-MM-DD" → Date เวลาท้องถิ่น 00:00 (ช่องวัน/เวลาแบบ DOS ตรงตัวอักษรทุกเครื่อง) */
function localMidnight(date: string): Date {
  const m = ISO_DATE.exec(date);
  const [y, mo, d] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  const at = new Date(y, mo - 1, d, 0, 0, 0, 0);
  // วันที่ไม่มีจริง (เลื่อนเดือน) หรือ TZ ของเครื่องไม่มีเที่ยงคืนของวันนั้น (ปรับเวลาฤดูร้อนตอน 00:00) — ห้ามเดา
  if (!m || at.getFullYear() !== y || at.getMonth() !== mo - 1 || at.getDate() !== d || at.getHours() !== 0) {
    throw new RangeError(`zip date must be a real YYYY-MM-DD with a local midnight: ${JSON.stringify(date)}`);
  }
  return at;
}

/** รอจน buffer ของ stream ว่างพอ (drain) หรือ stream ถูกปิด — ถอด listener ทั้งสองทุกครั้ง */
function drained(out: PassThrough): Promise<void> {
  if (!out.writableNeedDrain || out.destroyed) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      out.off("drain", done);
      out.off("close", done);
      resolve();
    };
    out.on("drain", done);
    out.on("close", done);
  });
}

export function createDeterministicZip({ date }: { date: string }): ZipWriter {
  const options = { mtime: localMidnight(date), mode: FILE_MODE, compress: false, forceDosTimestamp: true };
  const zip = new ZipFile();
  // @types/yazl ประกาศเป็น ReadableStream แต่ของจริงคือ PassThrough — ต้องใช้ฝั่งเขียนเพื่อรู้ว่า buffer เต็ม
  const out: unknown = zip.outputStream;
  if (!(out instanceof PassThrough)) throw new Error("yazl outputStream is not a PassThrough");
  // error ไปถึงฝั่งอ่านทาง toWeb — listener นี้กัน 'error' ที่ไม่มีใครรับทำ process ล้ม
  out.on("error", () => undefined);
  zip.on("error", (e: unknown) => out.destroy(e instanceof Error ? e : new Error(String(e))));
  const body = Readable.toWeb(out) as ReadableStream<Uint8Array>;
  const closed = () => new ZipClosedError("zip output closed before the archive was complete");

  return {
    body,
    async add(path, bytes) {
      if (out.destroyed) throw closed();
      // ไม่ copy — yazl อ่าน CRC จาก byte ชุดนี้แล้วเขียนออกตามลำดับ ผู้เรียกต้องไม่แก้ byte หลังส่งมา
      zip.addBuffer(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), path, options);
      await drained(out);
      if (out.destroyed) throw closed();
    },
    end() {
      zip.end();
    },
    abort(reason) {
      out.destroy(reason);
    },
  };
}

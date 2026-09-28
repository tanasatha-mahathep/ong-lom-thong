import { crc32 } from "node:zlib";

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** 0 = STORE */
  method: number;
  /** general purpose bit flag — bit 3 = data descriptor · bit 11 = ชื่อไฟล์ UTF-8 */
  flags: number;
  /** ช่องวัน/เวลาแบบ DOS "YYYY-MM-DD HH:MM:SS" (ไม่มีเขตเวลา) */
  modified: string;
  /** โหมดไฟล์ unix จาก external attributes */
  mode: number;
  /** ไบต์สูงของ version made by (3 = unix) */
  madeBy: number;
  /** ความยาว extra field ใน central directory */
  extraLength: number;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");
const dosDateTime = (date: number, time: number) =>
  `${pad(((date >> 9) & 0x7f) + 1980, 4)}-${pad((date >> 5) & 0xf)}-${pad(date & 0x1f)} ` +
  `${pad(time >> 11)}:${pad((time >> 5) & 0x3f)}:${pad((time & 0x1f) * 2)}`;

/**
 * อ่าน zip แบบเข้มสำหรับเทสต์ (ไม่พึ่งไลบรารีตัวเดียวกับที่เขียน) — ไฟล์ STORE · ไม่มี ZIP64 · ไม่มี comment
 * ตรวจ: EOCD · local header ตรงกับ central directory ทุกช่อง · CRC32 · ไม่มี data descriptor
 * · ไฟล์เรียงติดกันตั้งแต่ byte แรกจนถึง central directory ไม่มีช่องว่าง/ขยะ · ไฟล์ขาดท้าย = throw
 */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = buf.length - 22;
  if (eocd < 0 || buf.readUInt32LE(eocd) !== 0x06054b50) throw new Error("no end of central directory (truncated?)");
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt16LE(eocd + 8) !== count || buf.readUInt16LE(eocd + 20) !== 0) throw new Error("unexpected EOCD");
  if (cdOffset + cdSize !== eocd) throw new Error("central directory does not end at EOCD");

  const entries: ZipEntry[] = [];
  let cd = cdOffset;
  let nextLocal = 0;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error(`entry ${i}: bad central directory signature`);
    const nameLength = buf.readUInt16LE(cd + 28);
    const extraLength = buf.readUInt16LE(cd + 30);
    const commentLength = buf.readUInt16LE(cd + 32);
    const name = buf.toString("utf8", cd + 46, cd + 46 + nameLength);
    const field = {
      needed: buf.readUInt16LE(cd + 6),
      flags: buf.readUInt16LE(cd + 8),
      method: buf.readUInt16LE(cd + 10),
      time: buf.readUInt16LE(cd + 12),
      date: buf.readUInt16LE(cd + 14),
      crc: buf.readUInt32LE(cd + 16),
      compressed: buf.readUInt32LE(cd + 20),
      size: buf.readUInt32LE(cd + 24),
    };
    const local = buf.readUInt32LE(cd + 42);
    if (local !== nextLocal) throw new Error(`${name}: local header at ${local}, expected ${nextLocal}`);
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`${name}: bad local header signature`);
    const localField = {
      needed: buf.readUInt16LE(local + 4),
      flags: buf.readUInt16LE(local + 6),
      method: buf.readUInt16LE(local + 8),
      time: buf.readUInt16LE(local + 10),
      date: buf.readUInt16LE(local + 12),
      crc: buf.readUInt32LE(local + 14),
      compressed: buf.readUInt32LE(local + 18),
      size: buf.readUInt32LE(local + 22),
    };
    const localNameLength = buf.readUInt16LE(local + 26);
    const localExtraLength = buf.readUInt16LE(local + 28);
    if (buf.toString("utf8", local + 30, local + 30 + localNameLength) !== name) throw new Error(`${name}: name`);
    if (JSON.stringify(localField) !== JSON.stringify(field)) throw new Error(`${name}: local header ≠ central dir`);
    if (field.flags & 0x8) throw new Error(`${name}: data descriptor not expected`);
    if (field.method !== 0 || field.compressed !== field.size) throw new Error(`${name}: only STORE is expected`);
    const start = local + 30 + localNameLength + localExtraLength;
    const data = new Uint8Array(buf.subarray(start, start + field.size));
    if (data.length !== field.size) throw new Error(`${name}: truncated data`);
    if (crc32(data) !== field.crc) throw new Error(`${name}: CRC mismatch`);
    entries.push({
      name,
      data,
      method: field.method,
      flags: field.flags,
      modified: dosDateTime(field.date, field.time),
      mode: buf.readUInt32LE(cd + 38) >>> 16,
      madeBy: buf.readUInt16LE(cd + 4) >> 8,
      extraLength,
    });
    nextLocal = start + field.size;
    cd += 46 + nameLength + extraLength + commentLength;
  }
  if (nextLocal !== cdOffset) throw new Error("bytes between the last entry and the central directory");
  if (cd !== cdOffset + cdSize) throw new Error("central directory size mismatch");
  return entries;
}

/** อ่าน body ของ response/stream ทั้งหมดเป็น byte */
export async function readAll(body: ReadableStream<Uint8Array> | Response): Promise<Uint8Array> {
  return new Uint8Array(await new Response(body instanceof Response ? body.body : body).arrayBuffer());
}

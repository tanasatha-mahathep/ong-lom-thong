import { describe, expect, it } from "vitest";
import { readAll, readZip } from "../test/unzip";
import { ZipClosedError, createDeterministicZip } from "./zip";

const enc = (s: string) => new TextEncoder().encode(s);

async function build(files: [string, Uint8Array][], date = "2026-10-01") {
  const zip = createDeterministicZip({ date });
  const bytes = readAll(zip.body);
  for (const [path, data] of files) await zip.add(path, data);
  zip.end();
  return bytes;
}

describe("createDeterministicZip — zip ส่งบัญชีรายเดือน", () => {
  const files: [string, Uint8Array][] = [
    ["README.txt", enc("สวัสดี\r\n")],
    ["receipts/00000/RC6910-0001.pdf", enc("%PDF-1.7 fake\n")],
    ["manifest.json", enc('{"a":1}\n')],
  ];

  it("STORE · ขนาด/CRC ใน local header (ไม่มี data descriptor) · ลำดับตามที่เพิ่ม · byte ตรงกับต้นฉบับ", async () => {
    const entries = readZip(await build(files));
    expect(entries.map((e) => e.name)).toEqual(files.map(([name]) => name));
    for (const [i, e] of entries.entries()) {
      expect(e.data).toEqual(files[i]?.[1]);
      expect(e.method).toBe(0);
      expect(e.flags & 0x8).toBe(0);
      expect(e.flags & 0x800).toBe(0x800); // ชื่อไฟล์ UTF-8
    }
  });

  it("เวลา/สิทธิ์คงที่: วันที่กำหนด 00:00:00 ทุกไฟล์ (ไม่ขึ้นกับ TZ ของเครื่อง) · 0644 · ไม่มี extra field เวลา UTC", async () => {
    const entries = readZip(await build(files, "2026-02-01"));
    for (const e of entries) {
      expect(e.modified).toBe("2026-02-01 00:00:00");
      expect(e.mode).toBe(0o100644);
      expect(e.madeBy).toBe(3); // unix
      expect(e.extraLength).toBe(0);
    }
  });

  it("ข้อมูลเดิม = byte เดิม", async () => {
    expect(await build(files)).toEqual(await build(files));
    expect(await build(files)).not.toEqual(await build(files, "2026-11-01"));
  });

  it("backpressure: ไม่มีใครอ่าน = add() หยุดรอหลังไม่กี่ไฟล์ — ไม่กองทั้งเดือนไว้ในหน่วยความจำ", async () => {
    const zip = createDeterministicZip({ date: "2026-10-01" });
    const chunk = new Uint8Array(256 * 1024);
    let added = 0;
    const producing = (async () => {
      for (let i = 0; i < 40; i++) {
        await zip.add(`f${String(i).padStart(2, "0")}.bin`, chunk);
        added++;
      }
      zip.end();
    })();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(added).toBeLessThanOrEqual(3); // ค้างไม่เกิน ~1 MB แทนที่จะเป็น 10 MB ทั้งก้อน
    const bytes = await readAll(zip.body);
    await producing;
    expect(added).toBe(40);
    expect(readZip(bytes)).toHaveLength(40);
  });

  it("abort กลางทาง → ฝั่งอ่านได้ error (ไม่ใช่ zip ที่ดูครบ) · add หลังจากนั้น = ZipClosedError", async () => {
    const zip = createDeterministicZip({ date: "2026-10-01" });
    const reading = readAll(zip.body);
    await zip.add("a.txt", enc("a"));
    zip.abort(new Error("storage down"));
    await expect(reading).rejects.toThrow("storage down");
    await expect(zip.add("b.txt", enc("b"))).rejects.toBeInstanceOf(ZipClosedError);
  });

  it("ฝั่งอ่านเลิกกลางทาง (ปิดหน้า/ยกเลิกดาวน์โหลด) → add ที่รออยู่จบด้วย ZipClosedError ไม่ค้าง", async () => {
    const zip = createDeterministicZip({ date: "2026-10-01" });
    const adding = zip.add("big.bin", new Uint8Array(2 * 1024 * 1024));
    await zip.body.cancel();
    await expect(adding).rejects.toBeInstanceOf(ZipClosedError);
  });

  it("path ที่ออกนอกโฟลเดอร์/path เต็ม ถูกปฏิเสธ · วันที่ต้องมีจริง", async () => {
    const zip = createDeterministicZip({ date: "2026-10-01" });
    await expect(zip.add("../evil.pdf", enc("x"))).rejects.toThrow();
    await expect(zip.add("/etc/passwd", enc("x"))).rejects.toThrow();
    zip.abort(new Error("done"));
    await zip.body.cancel().catch(() => undefined);
    expect(() => createDeterministicZip({ date: "2026-02-30" })).toThrow(RangeError);
    expect(() => createDeterministicZip({ date: "2026-10" })).toThrow(RangeError);
  });
});

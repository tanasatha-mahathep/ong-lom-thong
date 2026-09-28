/** ชนิดรูปที่รับ — ตรวจจาก byte จริง (magic number) ไม่เชื่อ content-type ที่ client ส่งมา */
const SIGNATURES: { type: string; ext: string; match: (b: Uint8Array) => boolean }[] = [
  { type: "image/jpeg", ext: "jpg", match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: "image/png",
    ext: "png",
    match: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v),
  },
  {
    type: "image/webp",
    ext: "webp",
    match: (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  },
];

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export function sniffImage(bytes: Uint8Array): { type: string; ext: string } | null {
  const hit = SIGNATURES.find((s) => s.match(bytes));
  return hit ? { type: hit.type, ext: hit.ext } : null;
}

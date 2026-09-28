import { describe, expect, it, vi } from "vitest";
import { PHOTO_MAX_BYTES, canReadClipboard, imageFromDataTransfer, photoProblem, readClipboardImage } from "./photo";

const file = (name: string, type: string, size = 3) => new File([new Uint8Array(size)], name, { type });
const png = file("image.png", "image/png");
const pdf = file("scan.pdf", "application/pdf");

/** DataTransfer ขั้นต่ำที่ฟังก์ชันใช้ (jsdom ไม่มี DataTransfer จริง) */
function transfer(files: File[], itemFiles: File[] = []): DataTransfer {
  const items = itemFiles.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f }));
  return { files, items } as unknown as DataTransfer;
}

describe("photoProblem — เกณฑ์เดียวกับ API", () => {
  it("JPEG · PNG · WebP ขนาดไม่เกิน 5 MB ใช้ได้", () => {
    expect(photoProblem(png)).toBeNull();
    expect(photoProblem(file("a.jpg", "image/jpeg"))).toBeNull();
    expect(photoProblem(file("a.webp", "image/webp", PHOTO_MAX_BYTES))).toBeNull();
  });

  it("ชนิดอื่น · ใหญ่เกิน · ไฟล์ว่าง → ข้อความเดียวกับ API", () => {
    expect(photoProblem(pdf)).toBe("photo.wrongType");
    expect(photoProblem(file("a.bmp", "image/bmp"))).toBe("photo.wrongType");
    expect(photoProblem(file("big.png", "image/png", 6 * 1024 * 1024))).toBe("photo.tooLarge");
    expect(photoProblem(file("empty.png", "image/png", 0))).toBe("photo.emptyFile");
  });

  it("browser ไม่รู้ชนิด (type ว่าง) → ให้ API ตรวจจาก byte", () => {
    expect(photoProblem(file("photo", ""))).toBeNull();
  });
});

describe("imageFromDataTransfer — รูปจากการวาง/ลากวาง", () => {
  it("เลือกรูปก่อนไฟล์อื่น ทั้งใน files และ items", () => {
    expect(imageFromDataTransfer(transfer([pdf, png]))).toBe(png);
    expect(imageFromDataTransfer(transfer([pdf], [png]))).toBe(png);
    expect(imageFromDataTransfer(transfer([], [png]))).toBe(png);
  });

  it("ไม่มีรูปแต่มีไฟล์ → คืนไฟล์นั้นให้บอกเหตุผล · ไม่มีไฟล์ → null", () => {
    expect(imageFromDataTransfer(transfer([pdf]))).toBe(pdf);
    expect(imageFromDataTransfer(transfer([]))).toBeNull();
    expect(imageFromDataTransfer(null)).toBeNull();
  });
});

describe("readClipboardImage — ปุ่มวางรูปจากคลิปบอร์ด", () => {
  function stubClipboard(read: () => Promise<ClipboardItem[]>) {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { read } });
  }

  it("ได้รูปแรกในคลิปบอร์ดเป็น File", async () => {
    const blob = new Blob([new Uint8Array([1, 2])], { type: "image/png" });
    const text = { types: ["text/plain"], getType: vi.fn() };
    const image = { types: ["text/html", "image/png"], getType: vi.fn(() => Promise.resolve(blob)) };
    stubClipboard(() => Promise.resolve([text, image] as unknown as ClipboardItem[]));

    expect(canReadClipboard()).toBe(true);
    const photo = await readClipboardImage();
    expect(photo).toBeInstanceOf(File);
    expect(photo).toMatchObject({ name: "clipboard.png", type: "image/png", size: 2 });
    expect(image.getType).toHaveBeenCalledWith("image/png");
  });

  it("คลิปบอร์ดไม่มีรูป → null · ไม่ได้รับอนุญาต → throw", async () => {
    stubClipboard(() => Promise.resolve([{ types: ["text/plain"] }] as unknown as ClipboardItem[]));
    await expect(readClipboardImage()).resolves.toBeNull();

    stubClipboard(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
    await expect(readClipboardImage()).rejects.toMatchObject({ name: "NotAllowedError" });
  });

  it("browser ที่ไม่มี clipboard.read → ไม่แสดงปุ่ม", () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    expect(canReadClipboard()).toBe(false);
  });
});

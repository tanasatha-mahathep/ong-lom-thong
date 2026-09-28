import {
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Env } from "../env";

export interface StoredObject {
  body: Uint8Array<ArrayBuffer>;
  contentType: string;
}

/**
 * ที่เก็บไฟล์ (รูปลูกค้า · PDF) — มีแค่ put/get/exists ตั้งใจไม่มี delete (CLAUDE.md กฎ 5 · spec §9.2)
 * bucket เป็น private: ไฟล์ออกทาง API ที่ตรวจสิทธิ์แล้วเท่านั้น ไม่มี public URL (R13)
 * ไฟล์ที่ต้อง immutable (PDF ใบรับซื้อ/สำเนาบัตร) เขียนผ่าน putNew() เท่านั้น
 */
export interface Storage {
  put(key: string, body: Uint8Array<ArrayBuffer>, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  /** มี object ที่ key นี้ไหม — ตอบ false เฉพาะเมื่อ bucket บอกว่าไม่มี (404) · error อื่น throw (ไม่เดาว่าไม่มี) */
  exists(key: string): Promise<boolean>;
}

export function createS3Storage(env: Env): Storage {
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });
  const Bucket = env.S3_BUCKET;
  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        if (!res.Body) return null;
        return {
          // สำเนาลง ArrayBuffer ธรรมดา (SDK อาจคืน view บน buffer ที่ใช้ร่วม)
          body: new Uint8Array(await res.Body.transformToByteArray()),
          contentType: res.ContentType ?? "application/octet-stream",
        };
      } catch (e) {
        if (e instanceof NoSuchKey) return null;
        throw e;
      }
    },
    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return true;
      } catch (e) {
        // HEAD ไม่มี body → SDK แปลง 404 เป็น NotFound · บาง S3-compatible ส่ง NoSuchKey
        // 403 (ไม่มีสิทธิ์ ListBucket) และอื่น ๆ = ไม่รู้ → throw ให้ผู้เรียกล้มแทนที่จะเขียนทับ
        if (e instanceof NotFound || e instanceof NoSuchKey || httpStatus(e) === 404) return false;
        throw e;
      }
    },
  };
}

function httpStatus(e: unknown): number | undefined {
  return (e as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
}

/** key นี้มีไฟล์อยู่แล้ว — putNew() ไม่เขียนทับ */
export class ObjectExistsError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`object already exists: ${key}`);
    this.name = "ObjectExistsError";
    this.key = key;
  }
}

/**
 * เขียนไฟล์ที่ต้อง immutable (PDF ใบรับซื้อ · สำเนาบัตร — R15) — key มีไฟล์อยู่แล้ว = ObjectExistsError ไม่เขียนทับ
 *
 * ทำแบบ HEAD แล้วค่อย PUT จึงยังมีช่องว่างเล็ก ๆ: สองตัวเขียน key เดียวกันพร้อมกัน ต่างเห็นว่า "ยังไม่มี"
 * แล้ว PUT ทั้งคู่ → ตัวหลังทับ (S3 PUT เป็น atomic ต่อ object — ไม่มีไฟล์ครึ่ง ๆ แต่ตัวแรกหาย)
 * กติกา: **หนึ่งใบมีผู้เขียนคนเดียว** — pipeline/retry ต้องจองบิลก่อน render (ล็อกแถว/advisory lock ต่อบิล)
 * ยังไม่ใช้ `If-None-Match: *` (atomic จริง): bucket ของ Railway รันบน Tigris ที่รองรับตามเอกสาร
 * แต่ยังไม่ได้ทดสอบกับ bucket จริง — ถ้า endpoint ไม่รู้จัก header นี้ อาจเขียนทับเงียบ ๆ หรือปฏิเสธทุก PUT
 *
 * retry หลังอัปโหลดสำเร็จแต่อัปเดต DB ไม่ทัน → ได้ ObjectExistsError: ให้ใช้ไฟล์เดิม (get + sha256)
 * ไม่ render ใหม่ — Chromium ใส่เวลาสร้างในไฟล์ ได้ byte ไม่เหมือนเดิม
 */
export async function putNew(
  storage: Storage,
  key: string,
  body: Uint8Array<ArrayBuffer>,
  contentType: string,
): Promise<void> {
  if (await storage.exists(key)) throw new ObjectExistsError(key);
  await storage.put(key, body, contentType);
}

/** สำหรับเทสต์ — เก็บในหน่วยความจำ */
export function createMemoryStorage(): Storage & { keys(): string[] } {
  const objects = new Map<string, StoredObject>();
  return {
    put(key, body, contentType) {
      objects.set(key, { body, contentType });
      return Promise.resolve();
    },
    get: (key) => Promise.resolve(objects.get(key) ?? null),
    exists: (key) => Promise.resolve(objects.has(key)),
    keys: () => [...objects.keys()],
  };
}

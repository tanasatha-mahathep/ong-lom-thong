import {
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Env } from "../env";

/** user metadata ของ object (S3 `x-amz-meta-*`) — key ตัวเล็ก ค่า ASCII */
export type ObjectMetadata = Record<string, string>;

export interface ObjectHead {
  contentType: string;
  metadata: ObjectMetadata;
}

export interface StoredObject extends ObjectHead {
  body: Uint8Array<ArrayBuffer>;
}

/** ไฟล์เก็บถาวร (PDF ใบรับซื้อ · สำเนาบัตร) — เขียนครั้งเดียวผ่าน putNew() เท่านั้น */
export const ARCHIVE_PREFIXES = ["receipts/", "idcards/"] as const;
export const isArchiveKey = (key: string) => ARCHIVE_PREFIXES.some((prefix) => key.startsWith(prefix));

/**
 * ที่เก็บไฟล์ (รูปลูกค้า · PDF) — ตั้งใจไม่มี delete (CLAUDE.md กฎ 5 · spec §9.2)
 * bucket เป็น private: ไฟล์ออกทาง API ที่ตรวจสิทธิ์แล้วเท่านั้น ไม่มี public URL (R13)
 */
export interface Storage {
  /** ไฟล์ทั่วไป (รูปลูกค้า) — key ใต้ receipts/ · idcards/ ถูกปฏิเสธ: ไฟล์เก็บถาวรเขียนผ่าน putNew() เท่านั้น */
  put(key: string, body: Uint8Array<ArrayBuffer>, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  /** HEAD — null เฉพาะเมื่อ bucket บอกว่าไม่มี (404) · error อื่น throw (ไม่เดาว่าไม่มี) */
  exists(key: string): Promise<ObjectHead | null>;
  /** เขียนไฟล์เขียนครั้งเดียวพร้อม metadata เจ้าของ — ห้ามเรียกตรง ใช้ putNew() (ตรวจว่ายังไม่มีก่อน) */
  putImmutable(
    key: string,
    body: Uint8Array<ArrayBuffer>,
    contentType: string,
    metadata: ObjectMetadata,
  ): Promise<void>;
}

function refuseArchiveKey(key: string) {
  if (isArchiveKey(key)) throw new Error(`archive keys are write-once — use putNew(): ${key}`);
}

export function createS3Storage(env: Env): Storage {
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    // bucket ค้าง = request ค้างไม่รู้จบ — ต่อไม่ได้ใน 5 วินาที / ไม่จบใน 30 วินาที = error (PDF ไป failed แล้ว retry)
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
  });
  const Bucket = env.S3_BUCKET;
  const write = async (key: string, body: Uint8Array<ArrayBuffer>, contentType: string, metadata?: ObjectMetadata) => {
    await client.send(
      new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType, Metadata: metadata }),
    );
  };
  return {
    async put(key, body, contentType) {
      refuseArchiveKey(key);
      await write(key, body, contentType);
    },
    putImmutable: (key, body, contentType, metadata) => write(key, body, contentType, metadata),
    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        if (!res.Body) return null;
        return {
          // สำเนาลง ArrayBuffer ธรรมดา (SDK อาจคืน view บน buffer ที่ใช้ร่วม)
          body: new Uint8Array(await res.Body.transformToByteArray()),
          contentType: res.ContentType ?? "application/octet-stream",
          metadata: res.Metadata ?? {},
        };
      } catch (e) {
        if (e instanceof NoSuchKey) return null;
        throw e;
      }
    },
    async exists(key) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { contentType: res.ContentType ?? "application/octet-stream", metadata: res.Metadata ?? {} };
      } catch (e) {
        // HEAD ไม่มี body → SDK แปลง 404 เป็น NotFound · บาง S3-compatible ส่ง NoSuchKey
        // 403 (ไม่มีสิทธิ์ ListBucket) และอื่น ๆ = ไม่รู้ → throw ให้ผู้เรียกล้มแทนที่จะเขียนทับ
        if (e instanceof NotFound || e instanceof NoSuchKey || httpStatus(e) === 404) return null;
        throw e;
      }
    },
  };
}

function httpStatus(e: unknown): number | undefined {
  return (e as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
}

/** key นี้มีไฟล์อยู่แล้ว — putNew() ไม่เขียนทับ · metadata = ของ object ที่มีอยู่ (ไว้ตรวจเจ้าของก่อนรับมาใช้) */
export class ObjectExistsError extends Error {
  readonly key: string;
  readonly metadata: ObjectMetadata;
  constructor(key: string, metadata: ObjectMetadata = {}) {
    super(`object already exists: ${key}`);
    this.name = "ObjectExistsError";
    this.key = key;
    this.metadata = metadata;
  }
}

/**
 * เขียนไฟล์ที่ต้อง immutable (PDF ใบรับซื้อ · สำเนาบัตร — R15) — key มีไฟล์อยู่แล้ว = ObjectExistsError ไม่เขียนทับ
 * metadata บอกเจ้าของ (เช่น receipt-id) — ใครจะรับไฟล์ที่มีอยู่แล้วมาใช้ต้องตรวจว่าเป็นของตัวเองก่อน
 *
 * ทำแบบ HEAD แล้วค่อย PUT จึงยังมีช่องว่างเล็ก ๆ: สองตัวเขียน key เดียวกันพร้อมกัน ต่างเห็นว่า "ยังไม่มี"
 * แล้ว PUT ทั้งคู่ → ตัวหลังทับ (S3 PUT เป็น atomic ต่อ object — ไม่มีไฟล์ครึ่ง ๆ แต่ตัวแรกหาย)
 * กติกา: **หนึ่งใบมีผู้เขียนคนเดียว** — pipeline/retry ต้องจองบิลก่อน render (advisory lock ต่อบิล)
 * ยังไม่ใช้ `If-None-Match: *` (atomic จริง): bucket ของ Railway รันบน Tigris ที่รองรับตามเอกสาร
 * แต่ยังไม่ได้ทดสอบกับ bucket จริง — ถ้า endpoint ไม่รู้จัก header นี้ อาจเขียนทับเงียบ ๆ หรือปฏิเสธทุก PUT
 */
export async function putNew(
  storage: Storage,
  key: string,
  body: Uint8Array<ArrayBuffer>,
  contentType: string,
  metadata: ObjectMetadata = {},
): Promise<void> {
  const existing = await storage.exists(key);
  if (existing) throw new ObjectExistsError(key, existing.metadata);
  await storage.putImmutable(key, body, contentType, metadata);
}

/** สำหรับเทสต์ — เก็บในหน่วยความจำ (กติกาเดียวกับ S3: put ปฏิเสธ key เก็บถาวร) */
export function createMemoryStorage(): Storage & { keys(): string[] } {
  const objects = new Map<string, StoredObject>();
  return {
    put(key, body, contentType) {
      // throw ใน executor = promise ถูก reject (แบบเดียวกับ S3) ไม่ใช่ throw ออกไปตรง ๆ
      return new Promise<void>((resolve) => {
        refuseArchiveKey(key);
        objects.set(key, { body, contentType, metadata: {} });
        resolve();
      });
    },
    putImmutable(key, body, contentType, metadata) {
      objects.set(key, { body, contentType, metadata: { ...metadata } });
      return Promise.resolve();
    },
    get: (key) => Promise.resolve(objects.get(key) ?? null),
    exists(key) {
      const o = objects.get(key);
      return Promise.resolve(o ? { contentType: o.contentType, metadata: o.metadata } : null);
    },
    keys: () => [...objects.keys()],
  };
}

import {
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Env } from "../env";
import { sha256Hex } from "./pdfArchive";

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
  /**
   * เขียนไฟล์เขียนครั้งเดียว — ห้ามเรียกตรง ใช้ putNew() · ไม่เขียนทับ: มีอยู่แล้ว = ObjectExistsError
   * (S3: `If-None-Match: *` เมื่อ bucket รองรับ ไม่งั้นพึ่ง HEAD ใน putNew())
   */
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

const errorInfo = (e: unknown) => {
  const err = e as { name?: unknown; $metadata?: { httpStatusCode?: number } } | null;
  return { name: typeof err?.name === "string" ? err.name : "", status: err?.$metadata?.httpStatusCode };
};

/** bucket บอกว่าไม่รู้จัก conditional write — ใช้ HEAD แล้ว PUT แทน */
const conditionalUnsupported = (e: unknown) => {
  const { name, status } = errorInfo(e);
  return status === 501 || name === "NotImplemented" || (status === 400 && /InvalidArgument|InvalidRequest/.test(name));
};

export interface S3Timeouts {
  /** ต่อ TCP ไม่ได้ภายในเวลานี้ = error */
  connectionMs: number;
  /** ไม่ได้คำตอบทั้ง request ภายในเวลานี้ = error (ต้อง throwOnRequestTimeout — ค่าเริ่มต้นของ SDK แค่ warn) */
  requestMs: number;
  /** socket เงียบ (ไม่มี byte เข้าออก) นานเกินนี้ = error — กัน bucket ที่รับ connection แล้วไม่ตอบ */
  socketMs: number;
}

export const S3_TIMEOUTS: S3Timeouts = { connectionMs: 5_000, requestMs: 30_000, socketMs: 30_000 };

export function createS3Storage(
  env: Env,
  { timeouts = S3_TIMEOUTS, log = console }: { timeouts?: S3Timeouts; log?: Pick<Console, "warn"> } = {},
): Storage {
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    // ลองซ้ำครั้งเดียว — กรณีเลวสุดต่อคำสั่ง ~60 วินาที (ค่าเริ่มต้น 3 ครั้ง × 30 = 90) ให้ทั้งงานจบใน lease 3 นาที
    maxAttempts: 2,
    // bucket ค้าง = request ค้างไม่รู้จบ → งาน PDF ค้าง · หมดเวลา = error (ไฟล์ไป failed แล้ว retry ภายหลัง)
    requestHandler: {
      connectionTimeout: timeouts.connectionMs,
      requestTimeout: timeouts.requestMs,
      throwOnRequestTimeout: true,
      socketTimeout: timeouts.socketMs,
    },
  });
  const Bucket = env.S3_BUCKET;
  // ไม่รู้จนกว่าจะลอง — bucket ที่ปฏิเสธ If-None-Match ครั้งหนึ่งแล้ว ไม่ต้องลองซ้ำทุกไฟล์
  let conditionalWrites: "unknown" | "supported" | "unsupported" = "unknown";

  const write = async (
    key: string,
    body: Uint8Array<ArrayBuffer>,
    contentType: string,
    metadata?: ObjectMetadata,
    ifNoneMatch = false,
  ) => {
    await client.send(
      new PutObjectCommand({
        Bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        Metadata: metadata,
        ...(ifNoneMatch ? { IfNoneMatch: "*" } : {}),
      }),
    );
  };

  async function exists(key: string): Promise<ObjectHead | null> {
    try {
      const res = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
      return { contentType: res.ContentType ?? "application/octet-stream", metadata: res.Metadata ?? {} };
    } catch (e) {
      // HEAD ไม่มี body → SDK แปลง 404 เป็น NotFound · บาง S3-compatible ส่ง NoSuchKey
      // 403 (ไม่มีสิทธิ์ ListBucket) และอื่น ๆ = ไม่รู้ → throw ให้ผู้เรียกล้มแทนที่จะเขียนทับ
      if (e instanceof NotFound || e instanceof NoSuchKey || errorInfo(e).status === 404) return null;
      throw e;
    }
  }

  return {
    async put(key, body, contentType) {
      refuseArchiveKey(key);
      await write(key, body, contentType);
    },
    async putImmutable(key, body, contentType, metadata) {
      if (conditionalWrites !== "unsupported") {
        try {
          // atomic: bucket ปฏิเสธเองถ้ามี object อยู่แล้ว (412) — ปิดช่องว่างระหว่าง HEAD กับ PUT
          await write(key, body, contentType, metadata, true);
          conditionalWrites = "supported";
          return;
        } catch (e) {
          const { name, status } = errorInfo(e);
          if (status === 412 || name === "PreconditionFailed") {
            throw new ObjectExistsError(key, (await exists(key))?.metadata ?? {});
          }
          if (!conditionalUnsupported(e)) throw e;
          conditionalWrites = "unsupported";
          log.warn(`[storage] bucket rejects If-None-Match (${status ?? name}) — using HEAD-then-PUT`);
        }
      }
      await write(key, body, contentType, metadata);
    },
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
    exists,
  };
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
 * metadata บอกเจ้าของ (receipt-id · kind) + sha256 ของ byte ที่เขียน — ผู้ที่จะรับไฟล์ที่มีอยู่มาใช้ต้องตรวจก่อน
 *
 * HEAD ก่อน แล้ว PUT แบบ `If-None-Match: *` (bucket ปฏิเสธเองถ้ามีคนเขียนตัดหน้า) · bucket ที่ไม่รองรับ header นี้
 * เหลือช่องว่างเล็ก ๆ ระหว่าง HEAD กับ PUT — pipeline จึงมีผู้เขียนคนเดียวต่อบิล (lease) และ HEAD ซ้ำหลังเขียน
 * เพื่อยืนยันว่า object เป็นของเราจริง (receipt-id + sha256)
 */
export async function putNew(
  storage: Storage,
  key: string,
  body: Uint8Array<ArrayBuffer>,
  contentType: string,
  metadata: ObjectMetadata = {},
  /** เรียกทันทีก่อน PUT (หลัง HEAD) — throw = ไม่เขียน เช่น ตรวจว่ายังถือ lease ของงานนี้อยู่ */
  beforeWrite?: () => Promise<void>,
): Promise<{ sha256: string }> {
  const existing = await storage.exists(key);
  if (existing) throw new ObjectExistsError(key, existing.metadata);
  await beforeWrite?.();
  const sha256 = sha256Hex(body);
  await storage.putImmutable(key, body, contentType, { ...metadata, sha256 });
  return { sha256 };
}

/**
 * สำหรับเทสต์ — เก็บในหน่วยความจำ (กติกาเดียวกับ S3: put ปฏิเสธ key เก็บถาวร · putImmutable ไม่เขียนทับ)
 * replace() มีไว้จำลองไฟล์ถูกแก้/ผู้เขียนอื่นในเทสต์เท่านั้น
 */
export function createMemoryStorage(): Storage & {
  keys(): string[];
  replace(key: string, object: StoredObject): void;
} {
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
      return new Promise<void>((resolve) => {
        const existing = objects.get(key);
        if (existing) throw new ObjectExistsError(key, existing.metadata);
        objects.set(key, { body, contentType, metadata: { ...metadata } });
        resolve();
      });
    },
    get: (key) => Promise.resolve(objects.get(key) ?? null),
    exists(key) {
      const o = objects.get(key);
      return Promise.resolve(o ? { contentType: o.contentType, metadata: o.metadata } : null);
    },
    keys: () => [...objects.keys()],
    replace(key, object) {
      objects.set(key, object);
    },
  };
}

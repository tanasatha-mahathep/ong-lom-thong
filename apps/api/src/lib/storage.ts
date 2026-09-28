import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Env } from "../env";

export interface StoredObject {
  body: Uint8Array<ArrayBuffer>;
  contentType: string;
}

/**
 * ที่เก็บไฟล์ (รูปลูกค้า · PDF) — มีแค่ put/get ตั้งใจไม่มี delete (CLAUDE.md กฎ 5 · spec §9.2)
 * bucket เป็น private: ไฟล์ออกทาง API ที่ตรวจสิทธิ์แล้วเท่านั้น ไม่มี public URL (R13)
 */
export interface Storage {
  put(key: string, body: Uint8Array<ArrayBuffer>, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
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
  };
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
    keys: () => [...objects.keys()],
  };
}

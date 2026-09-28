// Fixture for ong-file-exposure.yml — run: semgrep --test .semgrep/rules (not application code)
import { ObjectCannedACL, PutBucketPolicyCommand, PutObjectCommand } from "@aws-sdk/client-s3";
// ruleid: ong-s3-presigned-url
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export function commands(key, body, policy) {
  return [
    // ruleid: ong-s3-public-access
    new PutObjectCommand({ Bucket: "media", Key: key, Body: body, ACL: "public-read" }),
    // ruleid: ong-s3-public-access
    new PutObjectCommand({ Bucket: "media", Key: key, Body: body, ACL: ObjectCannedACL.public_read }),
    // ruleid: ong-s3-public-access
    new PutBucketPolicyCommand({ Bucket: "media", Policy: policy }),
    // ok: ong-s3-public-access
    new PutObjectCommand({ Bucket: "media", Key: key, Body: body, ContentType: "image/png" }),
    // ok: ong-s3-public-access
    new PutObjectCommand({ Bucket: "media", Key: key, Body: body, ACL: "private" }),
  ];
}

export const presign = getSignedUrl;

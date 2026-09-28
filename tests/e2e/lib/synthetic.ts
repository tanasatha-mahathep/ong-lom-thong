import { randomBytes, randomInt } from "node:crypto";
import { isValidNationalId } from "@ong/core";

/**
 * Synthetic test data only (CLAUDE.md rule 8 · PDPA): Thai names start with "ทดสอบ", national IDs are made up.
 * Everything carries this run's id so reruns against the same stack never collide.
 */
export const runId = process.env.E2E_RUN_ID ?? "local";

/** short token unique to one call — for names we later search for */
export const uniqueToken = (): string => `${runId}-${randomBytes(3).toString("hex")}`;

export const thaiName = (label: string): string => `ทดสอบ ${label} ${uniqueToken()}`;

/**
 * 13-digit national ID that passes the checksum but cannot belong to anyone: digits 2–5 are the province and
 * district code, and province 00 does not exist. The check digit is whichever one @ong/core accepts —
 * no second checksum formula lives in the tests.
 */
export function syntheticNationalId(): string {
  const personType = String(randomInt(1, 9)); // 1–8, the types printed on real cards
  const body = `${personType}0000${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
  for (let check = 0; check <= 9; check++) {
    const id = `${body}${check}`;
    if (isValidNationalId(id)) return id;
  }
  throw new Error(`no check digit fits ${body}`); // cannot happen: exactly one digit satisfies mod 11
}

/** the same ID with the last digit changed — a checksum failure, for validation tests */
export function withBadCheckDigit(id: string): string {
  const last = Number(id.slice(-1));
  return `${id.slice(0, -1)}${(last + 1) % 10}`;
}

/** smallest valid PNG (1×1, transparent) — magic bytes are what the api sniffs */
export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

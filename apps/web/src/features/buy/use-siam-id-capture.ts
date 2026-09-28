import { isValidNationalId } from "@ong/core";
import { type ChangeEvent, type KeyboardEvent, useEffect, useRef } from "react";

/**
 * Siam ID เสียบบัตรแล้วพิมพ์ตามลำดับ 11 ช่องของฟอร์มลูกค้า: เลขบัตร Tab ชื่อ Tab … (อาจปิดท้ายด้วย Enter)
 * หน้า /buy ต้องการแค่เลขบัตร — พอครบ 13 หลัก ช่องนี้ "กลืน" ทุกปุ่มที่ตามมาจนเงียบไป idleMs
 * (Tab ไม่ย้ายช่อง · ตัวอักษรไม่ลงช่อง · Enter ไม่ทำอะไร) แล้วค่อยย้ายโฟกัสไปช่องถัดไปตามผลค้น
 * คนพิมพ์ 13 หลักเองแล้วกด Tab ก็ได้ผลเดียวกัน
 */
export const SIAM_ID_BURST_IDLE_MS = 800;

/** 13 หลักครบ → ค้นลูกค้า แล้วคืนฟังก์ชันย้ายโฟกัส (null = อยู่ช่องเดิม) */
export type OnNationalId = (digits: string) => Promise<(() => void) | null>;

interface Burst {
  timer: ReturnType<typeof setTimeout> | undefined;
  /** undefined = ยังค้นไม่เสร็จ */
  next: (() => void) | null | undefined;
  quiet: boolean;
}

const EDITING_KEYS = new Set(["Tab", "Enter", "Backspace", "Delete"]);

export function useSiamIdCapture({
  value,
  onValueChange,
  onNationalId,
  idleMs = SIAM_ID_BURST_IDLE_MS,
}: {
  value: string;
  onValueChange: (text: string) => void;
  onNationalId: OnNationalId;
  idleMs?: number;
}) {
  const burst = useRef<Burst | null>(null);

  useEffect(
    () => () => {
      if (burst.current) clearTimeout(burst.current.timer);
    },
    [],
  );

  /** เงียบแล้วและค้นเสร็จแล้ว = ปล่อยโฟกัส */
  function settle() {
    const b = burst.current;
    if (!b || !b.quiet || b.next === undefined) return;
    burst.current = null;
    b.next?.();
  }

  function extend() {
    const b = burst.current;
    if (!b) return;
    clearTimeout(b.timer);
    b.timer = setTimeout(() => {
      b.quiet = true;
      settle();
    }, idleMs);
  }

  const capturing = () => burst.current !== null && !burst.current.quiet;

  function start(digits: string) {
    if (burst.current) clearTimeout(burst.current.timer);
    const b: Burst = { timer: undefined, next: undefined, quiet: false };
    burst.current = b;
    extend();
    void onNationalId(digits).then(
      (next) => {
        if (burst.current !== b) return;
        b.next = next;
        settle();
      },
      () => {
        if (burst.current === b) b.next = null;
      },
    );
  }

  return {
    /** ยังกลืนปุ่มของ Siam ID อยู่ */
    capturing,
    /** ยกเลิกการกลืน (Esc / ล้างช่อง) */
    cancel: () => {
      if (burst.current) clearTimeout(burst.current.timer);
      burst.current = null;
    },
    inputProps: {
      value,
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        // ระหว่างกลืน ค่าคงเดิม (controlled) — ข้อความที่ Siam ID พิมพ์ตามมาไม่ลงช่องไหนเลย
        if (capturing()) return;
        const text = event.target.value;
        onValueChange(text);
        const digits = text.replace(/\D/g, "");
        if (digits.length !== 13) return;
        // หลักตรวจสอบไม่ผ่าน = พิมพ์เองพลาด ไม่ใช่ Siam ID จริง — แจ้งผล (onNationalId) แต่ไม่กลืนปุ่ม
        // จะได้ Backspace แก้เลขต่อได้ทันที ไม่ต้องรอ 800 ms เปล่า ๆ
        if (isValidNationalId(digits)) start(digits);
        else void onNationalId(digits);
      },
      onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
        if (!capturing()) return;
        if (event.key === "Escape") return;
        if (EDITING_KEYS.has(event.key) || event.key.length === 1) event.preventDefault();
        extend();
      },
    },
  };
}

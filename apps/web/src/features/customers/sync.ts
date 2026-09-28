import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent } from "react";
import { z } from "zod";
import { customerKeys } from "./keys";

/**
 * แจ้งแท็บอื่นเมื่อบันทึกลูกค้า — /buy เปิด /customers/new หรือหน้าแก้ไขในแท็บใหม่
 * แล้วต้องเห็นลูกค้าใหม่/สถานะบัตรใหม่ทันทีที่กลับมา โดยไม่พึ่ง window.opener (ลิงก์ _blank เป็น noopener)
 */
export const CUSTOMER_CHANNEL = "ong:customers";

export interface CustomerSaved {
  action: "created" | "updated";
  id: string;
}

const MessageSchema = z.object({
  type: z.literal("customer-saved"),
  action: z.enum(["created", "updated"]),
  id: z.string(),
  /** แท็บที่บันทึก — แท็บตัวเองอัปเดต cache จาก mutation แล้ว จึงข้ามข้อความของตัวเอง */
  tab: z.string(),
});

const TAB_ID = crypto.randomUUID();

const hasChannel = () => typeof BroadcastChannel === "function";

/** ประกาศว่าบันทึกลูกค้าแล้ว (ส่งจาก mutation ของ queries.ts) */
export function postCustomerSaved(saved: CustomerSaved): void {
  if (!hasChannel()) return;
  const channel = new BroadcastChannel(CUSTOMER_CHANNEL);
  channel.postMessage({ type: "customer-saved", tab: TAB_ID, action: saved.action, id: saved.id });
  channel.close();
}

/**
 * ฟังการบันทึกลูกค้าจากแท็บอื่น → ข้อมูลลูกค้าในแท็บนี้ถูก invalidate (ดึงใหม่ถ้าจอกำลังแสดง)
 * `onSaved` เช่น /buy เลือกลูกค้าที่เพิ่งเพิ่มให้เอง
 */
export function useCustomerSync(onSaved?: (saved: CustomerSaved) => void): void {
  const queryClient = useQueryClient();
  const notify = useEffectEvent((saved: CustomerSaved) => onSaved?.(saved));

  useEffect(() => {
    if (!hasChannel()) return;
    const channel = new BroadcastChannel(CUSTOMER_CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = MessageSchema.safeParse(event.data);
      if (!message.success || message.data.tab === TAB_ID) return;
      const { action, id } = message.data;
      void queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: customerKeys.detail(id) });
      notify({ action, id });
    };
    return () => channel.close();
  }, [queryClient]);
}

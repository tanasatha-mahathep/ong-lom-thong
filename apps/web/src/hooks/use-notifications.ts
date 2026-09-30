/** การแจ้งเตือนหนึ่งรายการ (รูปที่ UI ต้องการ — กำหนดใหม่ตาม API จริงเมื่อมี) */
export interface AppNotification {
  id: string;
  title: string;
  createdAt: string;
  read: boolean;
}

export interface NotificationsState {
  items: readonly AppNotification[];
  unread: number;
}

const EMPTY: NotificationsState = { items: [], unread: 0 };

/**
 * แหล่งข้อมูลของกระดิ่งแจ้งเตือน — ระบบยังไม่มี API การแจ้งเตือน จึงคืนรายการว่างเสมอ (ไม่มีข้อมูลสมมติ)
 * เมื่อมี endpoint แล้ว เปลี่ยนเฉพาะ hook นี้เป็น useQuery — NotificationBell ไม่ต้องแก้
 */
export function useNotifications(): NotificationsState {
  return EMPTY;
}

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** ข้อความเมื่อแสดงใบไม่ได้ (ข้อมูลใบขัดกันเอง = ReceiptDataError ของ @ong/core) */
  fallback: (message: string) => ReactNode;
  /** แจ้งตอนจับ error ได้ (คอมมิตเดียวกับ componentDidMount จึงเสร็จก่อน useEffect ของ parent) — เช่น กันการพิมพ์อัตโนมัติเมื่อใบพัง */
  onError?: (error: Error) => void;
}

/** <Receipt/> ตรวจยอดและรูปข้อมูลเองแล้ว throw เมื่อผิด — แสดงเหตุแทนการพังทั้งหน้า */
export class ReceiptErrorBoundary extends Component<Props, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  override render() {
    return this.state.error ? this.props.fallback(this.state.error.message) : this.props.children;
  }
}

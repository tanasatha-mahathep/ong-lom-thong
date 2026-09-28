import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CUSTOMER_CHANNEL, postCustomerSaved, useCustomerSync } from "./sync";

/** ช่องของ "อีกแท็บ" (BroadcastChannel คนละตัวในหน้าเดียวกันก็ส่งถึงกัน) */
let otherTab: BroadcastChannel;
beforeEach(() => {
  otherTab = new BroadcastChannel(CUSTOMER_CHANNEL);
});
afterEach(() => otherTab.close());

function renderSync(onSaved = vi.fn()) {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useCustomerSync(onSaved), { wrapper });
  return { ...view, onSaved, invalidate };
}

const saved = (id: string, tab = "another-tab") => ({ type: "customer-saved", action: "created", id, tab });

describe("useCustomerSync — BroadcastChannel ong:customers", () => {
  it("แท็บอื่นบันทึก → ข้อมูลลูกค้าในแท็บนี้ถูก invalidate และแจ้ง onSaved", async () => {
    const { onSaved, invalidate } = renderSync();

    otherTab.postMessage(saved("c1"));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ action: "created", id: "c1" }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["customers", "list"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["customers", "detail", "c1"] });
  });

  it("ข้ามข้อความของแท็บตัวเองและข้อความผิดรูป", async () => {
    // เก็บข้อความที่แท็บนี้ส่งจริง แล้วส่งซ้ำผ่านช่องทางเดียวกับข้อความอื่น (ลำดับแน่นอน)
    const post = vi.spyOn(BroadcastChannel.prototype, "postMessage");
    postCustomerSaved({ action: "updated", id: "mine" });
    const own: unknown = post.mock.calls[0]?.[0];
    post.mockRestore();
    const { onSaved } = renderSync();

    otherTab.postMessage(own);
    otherTab.postMessage({ type: "customer-saved", id: 42 });
    otherTab.postMessage("customer-saved");
    otherTab.postMessage(saved("c2"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved.mock.calls).toEqual([[{ action: "created", id: "c2" }]]);
  });

  it("เลิกฟังเมื่อออกจากหน้า", async () => {
    const { onSaved, unmount } = renderSync();
    const { onSaved: stillMounted } = renderSync();
    unmount();

    otherTab.postMessage(saved("c3"));

    await waitFor(() => expect(stillMounted).toHaveBeenCalled());
    expect(onSaved).not.toHaveBeenCalled();
  });
});

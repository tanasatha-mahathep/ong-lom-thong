import type th from "./th";

/** namespace `home` — home page (English · same keys as th.ts) */
export default {
  boardHint: "96.5% gold · price per 1 baht-weight of gold",
  noPrice: {
    canSet: "Set the price first to open buy-in bills",
    setPrice: "Set today's gold price",
    askManager: "Ask a manager to set today's gold price before opening bills",
  },
  shortcuts: "Shortcuts",
  buy: "Buy in",
  newCustomer: "New customer",
  todayTotals: {
    title: "Today's purchases",
    scope: "{{branch}} · excluding voided bills",
    pickBranch: "Choose a branch from the user menu to see its totals",
    count: "Bills",
    weight: "Total weight (g)",
    amount: "Total amount (baht)",
  },
} satisfies typeof th;

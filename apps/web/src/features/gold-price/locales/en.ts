import type th from "./th";

/** namespace `goldPrice` — today's gold price page (English · same keys as th.ts) */
export default {
  description: "Enter the gold bar selling price once each morning; the buying prices are calculated for you",
  managersOnly: {
    title: "Only managers and administrators can set the gold price",
    body: "If the price is wrong or not set, tell your branch manager",
  },
  errors: {
    missing: "Enter the gold bar selling price",
    forbidden: "This account cannot set the gold price — managers and administrators only",
    saveFailed: "Could not save the price. Please try again",
    quoteFailed: "Could not calculate the prices. Please try again",
    branchNotFound: "This branch was not found, or this account no longer has access to it",
    clearFailed: "Could not switch back to the central price. Please try again",
  },
  saved: "Today's gold price saved",
  savedDescription: "Gold bar selling price {{price}} baht",
  central: {
    title: "Today's central price",
    description: "{{date}} · every branch uses this price, except branches with their own branch price",
  },
  barSellLabel: "Gold bar selling price (baht)",
  barSellHint: "Type a number, e.g. 67850, then press Enter to save",
  save: "Save price",
  typo: {
    title: "Confirm today's gold price",
    branchTitle: "Confirm today's gold price for {{branch}}",
    body: "If the price is correct, confirm it. If you mistyped, go back and fix it",
    back: "Go back and edit",
    confirm: "Confirm and save this price",
  },
  preview: {
    title: "Prices to be saved",
    idle: "Enter the gold bar selling price and the buying prices will be calculated",
    busy: "Calculating…",
  },
  reference: {
    title: "Association price (reference)",
    description: "Gold Traders Association announcement · reference only, not the price the shop uses for bills",
    badge: "Reference",
    announced: "Announced {{time}}",
    round: "Round {{round}}",
    source: "Source {{source}}",
    barBuy: "Gold bar — buy",
    barSell: "Gold bar — sell",
    ornamentBuy: "Gold jewelry — buy",
    ornamentSell: "Gold jewelry — sell",
    stale: "This may not be today's latest announcement — check the association's announcement before using it",
    failed: "Could not fetch the reference price",
    disabled: "Fetching the association price is not enabled — check the association's announcement yourself",
    failedHint: "Check the association's announcement yourself and enter the price manually",
    loading: "Fetching the association price…",
    use: "Use the association price as the starting value",
    staleNoPrefill:
      "This price may not be the latest announcement, so it cannot be used as the starting value — enter the price from the latest announcement yourself",
    changed:
      "The association announced a new price after the field was filled — the price in the field no longer matches the latest announcement; check it or fill it again before saving",
    prefilled:
      "Gold bar selling price filled from the association price — not saved yet; check it, then press “Save price”",
    compact: "Association price (reference) · gold bar sell {{price}} baht · announced {{time}}",
    compactRound: "Association price (reference) · gold bar sell {{price}} baht · announced {{time}}, round {{round}}",
  },
  todayCard: {
    title: "Price this branch uses for bills today",
    description: "{{branch}} · {{date}}",
    branchOverride:
      "This branch has its own branch price — saving the central price on this page does not change this branch's price",
    notSet: "Today's gold price has not been set — buy-in bills cannot be opened until it is set",
  },
  branches: {
    title: "Branch prices",
    description:
      "Branches without their own price use the central price · a branch with its own price keeps it all day — saving a new central price does not change these branches until you press “Use central price”",
    caption: "Today's gold price per branch",
    column: {
      branch: "Branch",
      source: "Source",
      actions: "Actions",
    },
    source: {
      branch: "Branch",
      central: "Central price",
      none: "Not set",
    },
    branchLabel: "{{code}} {{name}}",
    current: "Current working branch",
    empty: "There are no branches this account can manage",
    set: "Set branch price",
    setFor: "Set branch price for {{branch}}",
    clear: "Use central price",
    clearFor: "Use central price for {{branch}}",
  },
  branchDialog: {
    title: "Set branch price — {{branch}}",
    description:
      "Today's price for this branch only; the buying prices are calculated for you · saving a central price later does not change it",
    current: "Current price: gold bar sell {{price}} baht ({{source}})",
    currentNone: "This branch has no price for today yet",
    label: "Gold bar selling price for this branch (baht)",
    cancel: "Cancel",
    save: "Save branch price",
    saved: "Branch price set for {{branch}}",
  },
  clearDialog: {
    title: "Switch {{branch}} back to the central price?",
    description:
      "Today's branch price will be removed and this branch will open bills at the central price (bills already opened do not change)",
    cancel: "Cancel",
    confirm: "Use central price",
    done: "{{branch}} is back on the central price",
  },
} satisfies typeof th;

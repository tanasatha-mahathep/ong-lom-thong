import type th from "./th";

/** namespace `bills` — bill search page and today's bills card (English · same keys as th.ts) */
export default {
  filters: {
    region: "Bill filters",
    search: "Search",
    searchPlaceholder: "e.g. RC6909-0001 · Somchai · national ID number",
    searchTooShort: "Type at least 2 characters",
    from: "From",
    to: "To",
    presets: "Date range presets",
    metal: "Metal",
    allMetals: "All metals",
    branch: "Branch",
    allBranches: "All branches",
    clear: "Clear filters",
  },

  presets: {
    today: "Today",
    yesterday: "Yesterday",
    last7Days: "Last 7 days",
    thisMonth: "This month",
    allDates: "All dates",
  },

  columns: {
    docNo: "No.",
    date: "Date",
    time: "Time",
    branch: "Branch",
    customer: "Customer",
    weight: "Weight (g)",
    amount: "Total (baht)",
    createdBy: "Recorded by",
    status: "Status",
    pdf: "PDF",
  },
  status: { void: "Voided" },
  pdf: { ready: "Ready", pending: "Generating", failed: "Failed", invalid: "Incomplete data" },

  results: {
    caption: "Buy-in bills matching the filters",
    empty: "No bills match your search",
    totals: "{{count}} bills · weight {{weight}} g · total {{amount}} baht",
    totalsNote: "Excluding voided bills",
    loading: "Searching…",
    error: "Bill search failed",
  },

  today: {
    title: "Today's buy-in bills",
    caption: "Today's buy-in bills for the current branch",
    viewAll: "View all",
    latestOnly: "Showing the latest {{count}}",
    empty: "No buy-in bills yet today",
    buy: "Buy in",
    noBranch: "Choose a branch from the user menu first",
    loadError: "Could not load today's bills",
  },
} satisfies typeof th;

## Summary

<!-- What changes and why. Link the spec section (05 §…) or rule (R1–R15). -->

## Checklist

- [ ] PR title is a Conventional Commit in English — it becomes the squash commit and drives the release
- [ ] `pnpm lint` · `pnpm typecheck` · `pnpm test` pass
- [ ] Money and weight use decimal.js / `numeric` only; totals come from `quoteBuy()` on the server
- [ ] New or changed endpoints are branch-scoped (fail-closed) and have a scoping test
- [ ] Schema changes include `pnpm db:generate` output
- [ ] No `.env`, secrets or real customer data

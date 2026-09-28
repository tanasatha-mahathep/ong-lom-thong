// Fixture for ong-html-injection.yml — run: semgrep --test .semgrep/rules (not application code)
import { html, raw } from "hono/html";

export function render(c, customer) {
  // ruleid: ong-hono-unescaped-html
  const a = raw(customer.nameTh);
  // ok: ong-hono-unescaped-html
  const b = raw("<hr>");
  // ok: ong-hono-unescaped-html
  const d = html`<td>${customer.nameTh}</td>`;
  if (customer.draft) {
    // ruleid: ong-hono-unescaped-html
    return c.html(`<td>${customer.nameTh}</td>`);
  }
  // ok: ong-hono-unescaped-html
  return c.html(html`<span>${a}${b}${d}</span>`);
}

#!/usr/bin/env node
/**
 * Measure how much each page jumps while it loads, in a real browser.
 *
 * For every page: the layout shift the browser itself reports (CLS, and which
 * elements moved), when content first showed and when it stopped changing,
 * how many skeletons it went through, and which requests it made more than
 * once. A page that loads cleanly has CLS ~0, one change from skeleton to
 * content, and no duplicates.
 *
 * Not a test — it reads a live environment (read-only: it only opens pages).
 *
 *   # playwright-core is not a dependency of the app; install it anywhere:
 *   npm i --prefix /tmp/pw playwright-core
 *   PLAYWRIGHT_CORE=/tmp/pw/node_modules/playwright-core/index.mjs \
 *   AUDIT_EMAIL=… AUDIT_PASSWORD=… \
 *   node scripts/audit-page-jumps.mjs https://bitcrm.tech-slk.com /deals /contacts/<id> …
 *
 * With no paths it audits every list page of the app. `CHROMIUM_PATH` points
 * at a Chromium binary (default: Playwright's cached headless shell);
 * `AUDIT_OUT` is where the JSON goes (default ./page-jumps.json).
 */
import { writeFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");

const [base = "http://localhost:3000", ...paths] = process.argv.slice(2);
const email = process.env.AUDIT_EMAIL;
const password = process.env.AUDIT_PASSWORD;
if (!email || !password) {
  console.error("Set AUDIT_EMAIL and AUDIT_PASSWORD.");
  process.exit(1);
}

const ALL_LIST_PAGES = [
  "/", "/deals", "/deals/new", "/dispatch", "/schedule", "/estimates", "/invoices", "/payments", "/work-orders",
  "/contacts", "/companies", "/calls", "/messages", "/automations", "/automations/activity", "/technicians",
  "/inventory", "/inventory/items", "/inventory/warehouses", "/inventory/containers", "/inventory/user-containers",
  "/inventory/templates", "/inventory/transfers", "/price-book", "/price-book/items", "/price-book/categories",
  "/price-book/brands", "/my-stock", "/profile", "/reports", "/reports/activity", "/reports/aging-invoices",
  "/reports/call-tracking", "/reports/commission", "/reports/items", "/reports/job-statistics", "/reports/jobs",
  "/reports/payments", "/reports/tax", "/settings", "/settings/general", "/settings/automations",
  "/settings/call-flows", "/settings/call-groups", "/settings/call-tags", "/settings/client-tags",
  "/settings/companies", "/settings/custom-fields", "/settings/documents", "/settings/external-companies",
  "/settings/job-fields", "/settings/job-sources", "/settings/job-statuses", "/settings/job-tags",
  "/settings/job-types", "/settings/message-templates", "/settings/messaging", "/settings/payments",
  "/settings/phone-numbers", "/settings/service-areas", "/admin/roles", "/admin/users",
];
const routes = paths.length ? paths : ALL_LIST_PAGES;

function defaultChromium() {
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  try {
    const dir = readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().pop();
    return dir ? join(cache, dir, "chrome-headless-shell-mac-arm64/chrome-headless-shell") : undefined;
  } catch {
    return undefined;
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? defaultChromium() });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addInitScript(() => {
  window.__cls = [];
  window.__clsTotal = 0;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__clsTotal += e.value;
        const src = (e.sources || []).map((s) => {
          const el = s.node && (s.node.nodeType === 1 ? s.node : s.node.parentElement);
          const what = `${el?.tagName?.toLowerCase() ?? "?"}${el?.getAttribute?.("role") ? `[${el.getAttribute("role")}]` : ""}`;
          return `${what}:${(el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40)}`;
        });
        window.__cls.push({ t: Math.round(e.startTime), v: +e.value.toFixed(4), src });
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
});

const login = await ctx.newPage();
await login.goto(base + "/login", { waitUntil: "networkidle" });
// Hydrated first — on a warm server a fixed wait once lost the race, the form
// went off as a native GET, nothing was signed in, and every route measured
// the login page (first = settled, no skeletons) without a word.
await login.waitForTimeout(1500);
await login.fill('input[type="email"], input[name="email"]', email);
await login.fill('input[type="password"]', password);
await login.click('button[type="submit"]');
try {
  await login.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
} catch {
  console.error("Login did not leave /login — check AUDIT_EMAIL / AUDIT_PASSWORD, or the server was not hydrated.");
  await browser.close();
  process.exit(1);
}
await login.waitForTimeout(3000);
await login.close();

const results = [];
for (const route of routes) {
  const p = await ctx.newPage();
  const reqs = [];
  const t0 = Date.now();
  p.on("request", (r) => {
    const u = r.url();
    // Live channels and heartbeats are not page loads.
    if (/\/api\//.test(u) && !/presence|calls\/active|conversations\/counters|\/stream|\/events/.test(u)) {
      reqs.push({ s: Date.now() - t0, u: u.replace(/^https?:\/\/[^/]+/, "") });
    }
  });
  try {
    await p.goto(base + route, { waitUntil: "domcontentloaded", timeout: 20000 });
  } catch (e) {
    results.push({ route, error: String(e).slice(0, 120) });
    await p.close();
    continue;
  }
  const changes = [];
  let last = null;
  let quietSince = Date.now();
  let firstContent = null;
  while (Date.now() - t0 < 9000) {
    const s = await p
      .evaluate(() => {
        const m = document.querySelector("main") || document.body;
        return { len: (m.innerText || "").length, sk: m.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length };
      })
      .catch(() => null);
    if (s) {
      const key = `${s.len}/${s.sk}`;
      if (key !== last) {
        changes.push({ t: Date.now() - t0, ...s });
        last = key;
        quietSince = Date.now();
        if (firstContent === null && s.len > 60) firstContent = Date.now() - t0;
      }
    }
    if (firstContent !== null && Date.now() - quietSince > 2500) break;
    await p.waitForTimeout(60);
  }
  const cls = await p.evaluate(() => ({ total: +window.__clsTotal.toFixed(4), shifts: window.__cls })).catch(() => ({ total: -1, shifts: [] }));
  const seen = {};
  for (const r of reqs) seen[r.u] = (seen[r.u] || 0) + 1;
  results.push({
    route,
    cls: cls.total,
    firstContent,
    settled: changes.at(-1)?.t ?? null,
    maxSkeletons: Math.max(0, ...changes.map((c) => c.sk)),
    requests: reqs.length,
    duplicates: Object.entries(seen).filter(([, n]) => n > 1).map(([u, n]) => `${n}x ${u}`),
    topShifts: cls.shifts.sort((a, b) => b.v - a.v).slice(0, 3),
  });
  writeFileSync(process.env.AUDIT_OUT ?? "page-jumps.json", JSON.stringify(results, null, 1));
  await p.close();
}
await browser.close();

for (const r of results) {
  if (r.error) console.log(`${r.route.padEnd(40)} ERROR ${r.error}`);
  else
    console.log(
      `${r.route.padEnd(40)} cls=${String(r.cls).padEnd(7)} first=${String(r.firstContent).padEnd(5)} settled=${String(r.settled).padEnd(5)} skeletons=${r.maxSkeletons} dup=${r.duplicates.length}`,
    );
}

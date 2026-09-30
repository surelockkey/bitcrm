import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const dev = process.env.NODE_ENV !== "production";

/** The API the browser talks to. Same default as `lib/env.ts`, so the CSP can name it. */
function apiOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://api.bitcrm.tech-slk.com/api";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

/**
 * Stripe.js loads from `js.stripe.com`, frames `hooks.stripe.com` for 3-D Secure
 * and bank redirects, and talks to `api.stripe.com`. Nothing else third-party
 * runs here.
 *
 * Two things this must not break:
 *  - Next's own inline bootstrap scripts (no nonce pipeline here, so
 *    `'unsafe-inline'` in `script-src`);
 *  - the document viewer's sandboxed `srcDoc` iframe, which inherits this
 *    policy — its HTML is full of inline `<style>` and remote `<img>`, and it
 *    runs no scripts of its own (no `allow-scripts` in its sandbox).
 */
function contentSecurityPolicy(): string {
  const api = apiOrigin();
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "script-src": ["'self'", "'unsafe-inline'", "https://js.stripe.com", "https://*.js.stripe.com", ...(dev ? ["'unsafe-eval'"] : [])],
    // Inline styles: Next's own, plus every server-rendered document we frame.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", "https://api.stripe.com", "https://*.js.stripe.com", ...(api ? [api] : []), ...(dev ? ["ws:"] : [])],
    // `'self'` also covers the viewer's `about:srcdoc` frame.
    "frame-src": ["'self'", "https://js.stripe.com", "https://*.js.stripe.com", "https://hooks.stripe.com"],
  };
  return Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(" ")}`)
    .join("; ");
}

const nextConfig: NextConfig = {
  // Both are source/dist workspace packages; bundle them cleanly.
  transpilePackages: ["@bitcrm/types", "@bitcrm/portal-ui"],
  // The repo lives inside a folder with a stray parent lockfile; pin the workspace root.
  turbopack: { root: path.join(dirname, "..", "..") },
  poweredByHeader: false,

  /**
   * Every page here is a bearer link to a client's documents: never framed,
   * never indexed, never leaked through a Referer to whatever a document links to.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;

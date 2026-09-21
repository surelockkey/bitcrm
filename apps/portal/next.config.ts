import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const dirname = path.dirname(fileURLToPath(import.meta.url));

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

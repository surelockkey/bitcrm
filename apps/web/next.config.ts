import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Transpile the shared workspace package so its output is bundled cleanly.
  transpilePackages: ["@bitcrm/types"],
  // Pin the workspace root — the repo lives inside a folder that also has a
  // stray parent lockfile, which otherwise confuses Turbopack's inference.
  turbopack: {
    root: path.join(dirname, "..", ".."),
  },

  /**
   * Serve the API from our own origin in development.
   *
   * `NEXT_PUBLIC_API_BASE_URL=/api` makes the browser resolve requests against
   * the current host, so they must be forwarded to the real gateway — otherwise
   * they hit Next itself, which has no such route, and every call 404s.
   * Same-origin also means no CORS and no third-party cookie rules to fight.
   *
   * Point API_PROXY_TARGET at the deployed gateway, or at a local one
   * (http://localhost:4000) when running the backend yourself. Unset it and the
   * app talks to NEXT_PUBLIC_API_BASE_URL directly.
   */
  async rewrites() {
    /**
     * Local development, straight to the services.
     *
     * The containerised gateway reaches the services over
     * `host.docker.internal`, and Docker Desktop's port forwarding on macOS
     * drops those connections regularly — measured on this repo at ~30% of
     * requests failing to connect through the gateway while every one of the
     * same requests succeeded when sent directly. It reads as services going
     * down; they never were.
     *
     * Next proxies these itself, so nothing crosses Docker. Prefix routing is
     * the same handful of rules nginx applies, and production is untouched:
     * there the gateway runs beside the services on Linux, with none of this.
     */
    if (process.env.API_DIRECT === "1") {
      const services = {
        users: 4001,
        crm: 4002,
        deals: 4003,
        inventory: 4004,
        search: 4005,
        telephony: 4006,
      };
      return Object.entries(services).map(([name, port]) => ({
        source: `/api/${name}/:path*`,
        destination: `http://localhost:${port}/api/${name}/:path*`,
      }));
    }

    const target = process.env.API_PROXY_TARGET;
    if (!target) return [];

    return [
      {
        source: "/api/:path*",
        destination: `${target.replace(/\/$/, "")}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;

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
};

export default nextConfig;

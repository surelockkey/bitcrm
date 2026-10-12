import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    css: false,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next"],
    /**
     * The default 5s is not enough for the heaviest component tests (the
     * template editor, the dispatch board, the deals field panel) once several
     * files render in parallel on a loaded machine: they pass alone and time
     * out together, which reads as a regression and is not one.
     */
    testTimeout: 20_000,
    hookTimeout: 20_000,
    /**
     * Half the cores, not all of them: on the 18 GB laptop a full run on every
     * core froze the machine and timed tests out that pass alone (2026-10-10:
     * 13–15 "failures" per full run, all green when rerun). Leaves room for
     * the dev server, the editor and other agents' runs.
     */
    maxWorkers: "50%",
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "."),
      // next/font is compiled away by Next; outside it the module has no loaders.
      "next/font/google": path.resolve(dirname, "test/next-font-google.ts"),
    },
  },
});

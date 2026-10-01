import { existsSync } from "node:fs";
import path from "node:path";

const PAGE_FILES = ["page.tsx", "page.ts", "page.jsx", "page.js"];

/**
 * Which of `hrefs` have a page in this build — server only (it reads the app
 * directory). The Reports route is prerendered, so this runs once, in
 * `next build`, where the source is present; `next dev` runs it per request.
 *
 * `null` when the app directory is not where it should be: the caller then
 * treats every route as built (a tile that may 404 beats a hub whose built
 * reports won't open).
 */
export function builtRoutes(hrefs: readonly string[], cwd: string = process.cwd()): string[] | null {
  const appDir = [path.join(cwd, "app"), path.join(cwd, "apps", "web", "app")].find((dir) =>
    existsSync(path.join(dir, "(app)")),
  );
  if (!appDir) return null;

  return hrefs.filter((href) => {
    const segments = href.split("/").filter(Boolean);
    const dir = path.join(appDir, "(app)", ...segments);
    return PAGE_FILES.some((file) => existsSync(path.join(dir, file)));
  });
}

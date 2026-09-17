const path = require('path');
const { execFileSync } = require('node:child_process');

/**
 * packages/types ships its built `dist`, not source, and this app imports it
 * over a `file:` link — so a suite run against a missing build dies on module
 * resolution, and one against a stale build passes while asserting yesterday's
 * contract. apps/web buys the same guarantee with its `prebuild` script.
 *
 * It is hooked here rather than in a `pretest` script because `npx jest` — what
 * CI and every editor integration actually run — skips npm's lifecycle hooks
 * entirely. `tsc` is incremental, so a no-op rebuild costs about a second.
 *
 * Deliberately the package's own `build` script rather than a local `tsc -p`:
 * this app pins TypeScript 6 for React Native, and 6 rejects packages/types
 * (TS5011 rootDir, TS5101 baseUrl), which is written for the 5.x that the root
 * install hoists.
 */
module.exports = function buildSharedTypes() {
  execFileSync(
    'npm',
    ['--prefix', path.resolve(__dirname, '../../packages/types'), 'run', 'build'],
    { stdio: 'inherit' },
  );
};

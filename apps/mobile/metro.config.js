const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// `@bitcrm/types` is a `file:` dependency, so node_modules/@bitcrm/types is a
// symlink out of this directory and into packages/types. Metro only watches
// the project root by default and would never see an edit to the shared
// package — the bundle would keep serving whatever dist happened to be built
// when the server started.
config.watchFolders = [workspaceRoot];

// This app is deliberately outside the root npm workspaces (Amplify builds
// apps/web from the repository root and must not install the Expo toolchain),
// so its dependencies live in apps/mobile/node_modules while the shared
// package's own tree is hoisted to the root. Metro has to read both.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// With the walk-up left on, a package present in both trees could be resolved
// out of the wrong one: the root holds react 19.2.4 and @tanstack/react-query
// 5.101.2 for apps/web, while Expo SDK 57 pins this app to 19.2.3 and 5.103.0.
// Two React Query instances mean two caches, and the technician's offline
// queue writes into one of them. Only the paths listed above are searched.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;

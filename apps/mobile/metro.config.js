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
//
// This is a *fallback* list, consulted only after the ordinary walk-up from the
// requiring file has failed. `disableHierarchicalLookup` — which would make it
// the only list — must stay off: npm leaves 73 packages un-hoisted inside
// apps/mobile/node_modules/<pkg>/node_modules precisely because their version
// conflicts with the top level, and without the walk-up Metro cannot see them.
// Measured on a dev bundle, turning it on silently swapped react-native's,
// expo's and @expo/metro-runtime's pretty-format 29.7.0 for the top-level
// 30.5.1 (dragging @jest/react-is-18 *and* -19 into the app), react-is 18.3.1
// for 19.3.0, react-refresh 0.14.2 for 0.19.0, and downgraded ansi-styles from
// the 5.2.0 pretty-format asks for to 4.3.0. It also cannot deliver the
// isolation it looks like it is buying: apps/mobile sits inside the repo, so
// the walk-up reaches the root node_modules either way.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;

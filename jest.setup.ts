/**
 * Global test setup.
 *
 * The native modules the app leans on (keychain, disk, connectivity, crypto,
 * GPS, camera) cannot run under Jest, so each is stood in with an in-memory
 * double that behaves like its real async API. What the doubles are there to
 * prove is that our code reads and writes the right keys, in the right order,
 * with the right payload — the native behaviour itself is validated on-device.
 *
 * Every backing store is named with the `mock` prefix, because Jest forbids a
 * module factory from referencing anything else out of scope.
 */

/* --------------------------------------------------- keychain (tokens) */

const mockKeychain = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn((key: string, value: string) => {
    mockKeychain.set(key, value);
    return Promise.resolve();
  }),
  getItemAsync: jest.fn((key: string) =>
    Promise.resolve(mockKeychain.has(key) ? mockKeychain.get(key)! : null),
  ),
  deleteItemAsync: jest.fn((key: string) => {
    mockKeychain.delete(key);
    return Promise.resolve();
  }),
}));

/* ---------------------------------------- AsyncStorage (profile, cache) */

const mockDisk = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn((key: string, value: string) => {
      mockDisk.set(key, value);
      return Promise.resolve();
    }),
    getItem: jest.fn((key: string) =>
      Promise.resolve(mockDisk.has(key) ? mockDisk.get(key)! : null),
    ),
    removeItem: jest.fn((key: string) => {
      mockDisk.delete(key);
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      mockDisk.clear();
      return Promise.resolve();
    }),
    getAllKeys: jest.fn(() => Promise.resolve([...mockDisk.keys()])),
  },
}));

/* ------------------------------------------------------- connectivity */

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(() =>
      Promise.resolve({ isConnected: true, isInternetReachable: true }),
    ),
  },
}));

/* ------------------------------------------------------------- crypto */

let mockUuidCounter = 0;

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => {
    mockUuidCounter += 1;
    return `00000000-0000-4000-8000-${String(mockUuidCounter).padStart(12, '0')}`;
  }),
}));

/* ------------------------------------------------------------ haptics */

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

/* ------------------------------------------------------ SQLite (queues) */

// Not a fake: a real SQLite engine, so the queue's own SQL is what runs. See
// src/test/expo-sqlite-double.ts for why that distinction matters here.
jest.mock('expo-sqlite', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./src/test/expo-sqlite-double'),
);

beforeEach(() => {
  mockKeychain.clear();
  mockDisk.clear();
  mockUuidCounter = 0;
  jest.clearAllMocks();
});

// Required after the mock is registered; `require` here rather than at the top
// so the double is only loaded by suites that touch SQLite.
const sqliteDouble = () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./src/test/expo-sqlite-double') as {
    __resetSqlite: () => void;
    __closeSqlite: () => void;
  };

afterEach(() => {
  sqliteDouble().__resetSqlite();
});

// An open SQLite handle keeps Node's event loop alive, and Jest hangs after
// the last test rather than exiting.
afterAll(() => {
  sqliteDouble().__closeSqlite();
});

/**
 * Global test setup.
 *
 * `expo-secure-store` is a native module (device keychain / Android keystore),
 * so it can't run under Jest. We stand in an in-memory Map that behaves like
 * its async API. Real persistence is validated on-device; these tests only
 * assert that the token store reads and writes the right keys.
 *
 * The backing store is named with the `mock` prefix so Jest allows the module
 * factory to reference it (out-of-scope refs are otherwise forbidden).
 */
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

beforeEach(() => {
  mockKeychain.clear();
  jest.clearAllMocks();
});

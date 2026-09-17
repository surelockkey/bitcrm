const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

interface CryptoLike {
  getRandomValues<T extends Uint8Array>(array: T): T;
}

/** 12-char lowercase alphanumeric id (crypto-random when available). */
export function newId(): string {
  const bytes = new Uint8Array(12);
  const cryptoObj = (globalThis as { crypto?: CryptoLike }).crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

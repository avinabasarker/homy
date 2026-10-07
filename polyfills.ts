// polyfills.ts — Hermes lacks Web Crypto; install it, backed by expo-crypto.
import * as Crypto from 'expo-crypto';
import nacl from 'tweetnacl';

const g = globalThis as any;

if (typeof g.crypto !== 'object' || g.crypto === null) {
  g.crypto = {};
}

if (typeof g.crypto.getRandomValues !== 'function') {
  g.crypto.getRandomValues = (array: Uint8Array): Uint8Array =>
    Crypto.getRandomValues(array);
}

if (typeof g.crypto.randomUUID !== 'function') {
  g.crypto.randomUUID = (): string => Crypto.randomUUID();
}

nacl.setPRNG((x: Uint8Array, n: number) => {
  const bytes = Crypto.getRandomValues(new Uint8Array(n));
  for (let i = 0; i < n; i++) x[i] = bytes[i];
});

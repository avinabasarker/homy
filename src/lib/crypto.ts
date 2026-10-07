// crypto.ts — Phase 4 E2EE core (tweetnacl only, no custom primitives).
//
// Pair keys: X25519 static-static. shared = nacl.scalarMult(mySK, theirPK);
// conversation key = nacl.hash(shared || sorted identity pks) so BOTH sides
// derive the same 32-byte key without transmitting it. Messages are sealed
// with nacl.secretbox (XSalsa20-Poly1305) under a random 24-byte nonce.
// No key material is ever logged or persisted outside SecureStore (Part A).
import '../../polyfills';

import nacl from 'tweetnacl';

import { concatBytes } from './bytea';

export interface SealedMessage {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

/**
 * Derive the shared 32-byte conversation key for a contact pair.
 * Both sides call this with (own secret, peer public) and get the same key,
 * because scalarMult is commutative: sk_A · pk_B == sk_B · pk_A.
 * The sorted public keys are folded into the hash to bind the key to the
 * exact pair (and to keep a future group-key upgrade possible).
 */
export function derivePairKey(
  myIdentitySecretKey: Uint8Array,
  theirIdentityPublicKey: Uint8Array,
  myIdentityPublicKey: Uint8Array,
): Uint8Array {
  const shared = nacl.scalarMult(myIdentitySecretKey, theirIdentityPublicKey);
  const [a, b] =
    compareBytes(myIdentityPublicKey, theirIdentityPublicKey) <= 0
      ? [myIdentityPublicKey, theirIdentityPublicKey]
      : [theirIdentityPublicKey, myIdentityPublicKey];
  return nacl.hash(concatBytes(shared, a, b)).slice(0, nacl.secretbox.keyLength);
}

function compareBytes(x: Uint8Array, y: Uint8Array): number {
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    if (x[i] !== y[i]) {
      return x[i] < y[i] ? -1 : 1;
    }
  }
  return x.length - y.length;
}

/** Encrypt plaintext bytes for one conversation key with a random nonce. */
export function seal(plaintext: Uint8Array, key: Uint8Array): SealedMessage {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(plaintext, nonce, key);
  return { ciphertext, nonce };
}

/** Decrypt; returns null when the key or payload is wrong (auth failure). */
export function open(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  key: Uint8Array,
): Uint8Array | null {
  return nacl.secretbox.open(ciphertext, nonce, key);
}

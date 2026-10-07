// pin.ts — device-local PIN hashing, EXACTLY per Part H #7:
// 16-byte random salt (expo-crypto) → nacl.hash iterated 2000 times over
// concat(pinBytes, salt) → JSON {saltHex, hashHex} in SecureStore.
// Verification is constant-time. The PIN NEVER leaves this module, never logged.
import '../../polyfills';

import * as Crypto from 'expo-crypto';
import nacl from 'tweetnacl';

import { concatBytes, constantTimeEqual, fromHex, toHex, utf8ToBytes } from './bytea';
import { secureDelete, secureGet, secureHasKey, secureKeys, secureSet } from './secureStore';

const PIN_ITERATIONS = 2000;
const PIN_SALT_BYTES = 16;

export function isPinFormatValid(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  Crypto.getRandomValues(bytes);
  return bytes;
}

async function hashPin(
  pin: string,
  existingSaltHex?: string,
): Promise<{ saltHex: string; hashHex: string }> {
  if (!isPinFormatValid(pin)) {
    throw new Error('PIN must be 4 to 8 digits.');
  }
  const salt = existingSaltHex ? fromHex(existingSaltHex) : randomBytes(PIN_SALT_BYTES);
  let acc = concatBytes(utf8ToBytes(pin), salt);
  for (let i = 0; i < PIN_ITERATIONS; i++) {
    acc = nacl.hash(acc);
  }
  return { saltHex: toHex(salt), hashHex: toHex(acc) };
}

export async function setPinSecret(userId: string, pin: string): Promise<void> {
  const { saltHex, hashHex } = await hashPin(pin);
  await secureSet(secureKeys.pin(userId), JSON.stringify({ saltHex, hashHex }));
}

export async function verifyPinSecret(userId: string, pin: string): Promise<boolean> {
  const raw = await secureGet(secureKeys.pin(userId));
  if (!raw) {
    return false;
  }
  const stored = JSON.parse(raw) as { saltHex: string; hashHex: string };
  const candidate = await hashPin(pin, stored.saltHex);
  return constantTimeEqual(fromHex(candidate.hashHex), fromHex(stored.hashHex));
}

export async function pinExists(userId: string): Promise<boolean> {
  return secureHasKey(secureKeys.pin(userId));
}

export async function clearPinSecret(userId: string): Promise<void> {
  await secureDelete(secureKeys.pin(userId));
}

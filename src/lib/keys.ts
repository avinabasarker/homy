// keys.ts — identity key + prekey generation and persistence.
// Phase 4 will derive per-conversation keys from these via X25519
// (nacl.scalarMult + nacl.hash). Private halves NEVER leave SecureStore,
// are never logged, and never reach the server (only public halves do).
import '../../polyfills';

import nacl from 'tweetnacl';

import { fromHex, toHex, toPostgrestBytea } from './bytea';
import { secureGet, secureKeys, secureSet } from './secureStore';
import { supabase } from './supabase';

export interface DeviceKeys {
  identityPublicKey: Uint8Array;
  identitySecretKey: Uint8Array;
  prekeySecret: Uint8Array;
}

function generateFreshKeys(): { keys: DeviceKeys; prekeyPublic: Uint8Array } {
  const identity = nacl.box.keyPair(); // X25519 keypair
  const prekey = nacl.box.keyPair(); // X25519 keypair
  return {
    keys: {
      identityPublicKey: identity.publicKey,
      identitySecretKey: identity.secretKey,
      prekeySecret: prekey.secretKey,
    },
    prekeyPublic: prekey.publicKey,
  };
}

async function loadLocalKeys(userId: string): Promise<DeviceKeys | null> {
  const [idSkHex, idPkHex, preSkHex] = await Promise.all([
    secureGet(secureKeys.identitySecretKey(userId)),
    secureGet(secureKeys.identityPublicKey(userId)),
    secureGet(secureKeys.prekeySecretKey(userId)),
  ]);
  if (!idSkHex || !idPkHex || !preSkHex) {
    return null;
  }
  return {
    identityPublicKey: fromHex(idPkHex),
    identitySecretKey: fromHex(idSkHex),
    prekeySecret: fromHex(preSkHex),
  };
}

/**
 * Part H #13 (registration order): after auth succeeds, make sure THIS device
 * has its key material and the server has the public halves.
 * - Same device returning: identity keys are reused (idempotent upsert) and a
 *   fresh prekey is uploaded.
 * - Brand-new device: everything is generated and uploaded.
 */
export async function ensureDeviceKeys(userId: string): Promise<DeviceKeys> {
  let keys = await loadLocalKeys(userId);
  let prekeyPublic: Uint8Array;

  if (keys) {
    const prekey = nacl.box.keyPair();
    prekeyPublic = prekey.publicKey;
    keys = { ...keys, prekeySecret: prekey.secretKey };
    await secureSet(secureKeys.prekeySecretKey(userId), toHex(prekey.secretKey));
  } else {
    const fresh = generateFreshKeys();
    keys = fresh.keys;
    prekeyPublic = fresh.prekeyPublic;
    await Promise.all([
      secureSet(secureKeys.identitySecretKey(userId), toHex(keys.identitySecretKey)),
      secureSet(secureKeys.identityPublicKey(userId), toHex(keys.identityPublicKey)),
      secureSet(secureKeys.prekeySecretKey(userId), toHex(keys.prekeySecret)),
    ]);
  }

  const [publicKeysResult, prekeysResult] = await Promise.all([
    supabase.from('public_keys').upsert({
      user_id: userId,
      identity_key: toPostgrestBytea(keys.identityPublicKey),
    }),
    supabase.from('prekeys').insert({
      user_id: userId,
      prekey: toPostgrestBytea(prekeyPublic),
    }),
  ]);
  if (publicKeysResult.error) {
    throw new Error(`Could not save your public key: ${publicKeysResult.error.message}`);
  }
  if (prekeysResult.error) {
    throw new Error(`Could not save your prekey: ${prekeysResult.error.message}`);
  }
  return keys;
}

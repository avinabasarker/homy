// media.ts — Phase 7 media plumbing (ITEM 8). Never improvises:
//
// ENCRYPTION: the EXISTING conversation key from crypto.ts.
//   seal:   random 24-byte nonce; blob = nonce ‖ nacl.secretbox(file, nonce, key)
//   unseal: split the first 24 bytes, open with the rest.
// PATH: conv/<conversationId>/<randomUUID>.enc — always.
// ORDER: validate → read bytes → seal → UPLOAD → THEN insert the message
//   row. Any upload failure = no row + honest error to the caller.
//
// Local cache: FileSystem cacheDirectory/media/<messageId> — reuse before
// any network fetch. Undecryptable/tampered blobs are REJECTED (null) and
// the caller renders a locked placeholder — never a crash.
import '../../polyfills';

import * as FileSystem from 'expo-file-system/legacy';
import nacl from 'tweetnacl';

import { concatBytes } from './bytea';
import { open as unsealRaw } from './crypto';
import { supabase } from './supabase';

const NONCE_LEN = nacl.secretbox.nonceLength; // 24

export const MEDIA_BUCKET = 'homy-media';

export function mediaPath(conversationId: string): string {
  return `conv/${conversationId}/${globalThis.crypto.randomUUID()}.enc`;
}

/** nonce ‖ secretbox(bytes) — the wire format for every media blob. */
export function sealMedia(plain: Uint8Array, key: Uint8Array): Uint8Array {
  const nonce = nacl.randomBytes(NONCE_LEN);
  const boxed = nacl.secretbox(plain, nonce, key);
  return concatBytes(nonce, boxed);
}

/** Inverse of sealMedia — null on tampered/wrong-key input. */
export function unsealMedia(blob: Uint8Array, key: Uint8Array): Uint8Array | null {
  if (blob.length <= NONCE_LEN) {
    return null;
  }
  const nonce = blob.slice(0, NONCE_LEN);
  const boxed = blob.slice(NONCE_LEN);
  return unsealRaw(boxed, nonce, key);
}

/** Upload a sealed blob; returns the storage path that was written. */
export async function uploadSealedMedia(
  storagePath: string,
  blob: Uint8Array,
): Promise<void> {
  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(storagePath, blob, { upsert: false, contentType: 'application/octet-stream' });
  if (error) {
    // Honest failure — the caller MUST NOT insert any message row.
    throw new Error(`Media upload failed: ${error.message}`);
  }
}

export interface CachedMediaFile {
  uri: string;
  /** Present when the cached file is a plain (already-unsealed) copy. */
  deleted?: false;
}

/** Cache path for a message's decrypted media (inside cacheDirectory). */
function cacheFileFor(messageId: string): string {
  return `${FileSystem.cacheDirectory}media-${messageId}`;
}

/** Bytes → cache file (deduped by message id). Returns the local uri. */
export async function cacheBytes(
  messageId: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<string> {
  const path = cacheFileFor(messageId);
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    await FileSystem.writeAsStringAsync(
      path,
      toBase64(bytes),
      { encoding: FileSystem.EncodingType.Base64 },
    );
  }
  return `${path}?mime=${encodeURIComponent(mimeType)}`;
}

/** Read a cache file back to bytes. Returns null on any miss/corruption. */
export async function readCachedBytes(messageId: string): Promise<Uint8Array | null> {
  try {
    const path = cacheFileFor(messageId);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) {
      return null;
    }
    const b64 = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return fromBase64(b64);
  } catch {
    return null; // corrupt cache = miss; caller re-downloads
  }
}

/** Fast path: is this media already cached locally? */
export async function hasCachedMedia(messageId: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(cacheFileFor(messageId));
  return info.exists;
}

/** Download + unseal a peer's media with the logged-in session (RLS). */
export async function downloadUnsealedMedia(
  storagePath: string,
  key: Uint8Array,
): Promise<Uint8Array | null> {
  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .download(storagePath);
  if (error || !data) {
    return null; // caller renders a locked placeholder, never crashes
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  return unsealMedia(bytes, key);
}

/** Delete the local cache file (used by disappearing-media purge). */
export async function deleteCachedMedia(messageId: string): Promise<void> {
  const path = cacheFileFor(messageId);
  const info = await FileSystem.getInfoAsync(path);
  if (info.exists) {
    await FileSystem.deleteAsync(path, { idempotent: true });
  }
}

/**
 * Read a local file (picker output / recorder output) into bytes.
 * Base64 round-trip through the legacy FileSystem API — the only path that
 * works in Expo Go on this SDK.
 */
export async function readBytesFromFile(uri: string): Promise<Uint8Array> {
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return fromBase64(b64);
}

/** File size in bytes (the legacy FS info always includes size when exists). */
export async function getFileSize(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists ? (info as { exists: true; size: number }).size : 0;
}

// ---- base64 helpers (polyfill-free; RN has atob/btoa shims in polyfills) ----

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(bin);
  }
  // Hermes fallback (Buffer is NOT available in the RN runtime).
  const HEX = '0123456789abcdef';
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += HEX[bytes[i] >> 4]!;
    hex += HEX[bytes[i] & 15]!;
  }
  let out = '';
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < hex.length; i += 6) {
    const chunk = hex.slice(i, i + 6);
    const bits = parseInt(chunk.padEnd(6, '0'), 16);
    const chars = bits.toString(2).padStart(chunk.length * 4, '0');
    for (let j = 0; j < chunk.length * 2; j++) {
      out += table[parseInt(chars.slice(j * 6, j * 6 + 6), 2)]!;
    }
  }
  const pad = (6 - (hex.length % 6)) % 6;
  out = out.slice(0, out.length - Math.ceil(pad / 2));
  while (out.length % 4 !== 0) {
    out += '=';
  }
  return out;
}

function fromBase64(b64: string): Uint8Array {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/[=\s]/g, '');
  let bits = '';
  for (const ch of clean) {
    const idx = table.indexOf(ch);
    if (idx < 0) {
      throw new Error('Corrupt cache file (bad base64).');
    }
    bits += idx.toString(2).padStart(6, '0');
  }
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return out;
}

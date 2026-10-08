// messages.ts — Phase 4 E2EE message flow (Part D4).
//
// Send: fetch the contact's public identity key → derive the pair key →
// nacl.secretbox → insert into messages (ciphertext/nonce as \x hex bytea).
// Receive: list rows for the conversation → decrypt with the same pair key.
//
// Conversation ids come from the server RPC `ensure_conversation(peer)`
// (schema: supabase/schema.sql) — never derived client-side.
import '../../polyfills';

import { bytesToUtf8, fromHex, fromPostgrestBytea, toPostgrestBytea, utf8ToBytes } from './bytea';
import { derivePairKey, open, seal } from './crypto';
import { secureGet, secureKeys } from './secureStore';
import { supabase } from './supabase';

/**
 * Resolve (or create) the conversation row between me and `peer` via the
 * server RPC. In-memory cache per peer so repeated opens don't re-RPC;
 * cache lives only for the process lifetime.
 */
const conversationCache = new Map<string, string>();

export async function ensureConversation(peerId: string): Promise<string> {
  const cached = conversationCache.get(peerId);
  if (cached) {
    return cached;
  }
  const { data, error } = await supabase.rpc('ensure_conversation', { peer: peerId });
  if (error || typeof data !== 'string') {
    throw new Error(
      error && error.message
        ? `Could not open the conversation: ${error.message}`
        : 'Could not open the conversation.',
    );
  }
  conversationCache.set(peerId, data);
  return data;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  body: string;
  sentAt: string;
  /** True when decryption failed (wrong key/tampered) — shown as a placeholder. */
  undecryptable?: boolean;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  ciphertext: string;
  nonce: string;
  sent_at: string;
}

interface PublicKeyRow {
  user_id: string;
  identity_key: string;
}

export interface PairKeys {
  myIdentitySecretKey: Uint8Array;
  myIdentityPublicKey: Uint8Array;
  theirIdentityPublicKey: Uint8Array;
}

export class SendMessageError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

/** Read my identity keypair from SecureStore (created in Phase 2). */
export async function loadMyIdentityKeys(userId: string): Promise<Omit<PairKeys, 'theirIdentityPublicKey'> | null> {
  const [skHex, pkHex] = await Promise.all([
    secureGet(secureKeys.identitySecretKey(userId)),
    secureGet(secureKeys.identityPublicKey(userId)),
  ]);
  if (!skHex || !pkHex) {
    return null;
  }
  return {
    myIdentitySecretKey: fromHex(skHex),
    myIdentityPublicKey: fromHex(pkHex),
  };
}

export async function fetchPeerIdentityKey(peerUserId: string): Promise<Uint8Array> {
  const { data, error } = await supabase
    .from('public_keys')
    .select('user_id, identity_key')
    .eq('user_id', peerUserId)
    .maybeSingle();
  if (error) {
    throw new SendMessageError(`Could not read their public key: ${error.message}`, 'fetch');
  }
  const row = (data as PublicKeyRow | null) ?? null;
  if (!row) {
    throw new SendMessageError(
      'They have no public key registered yet. Ask them to log in once and try again.',
      'no-key',
    );
  }
  return fromPostgrestBytea(row.identity_key);
}

/**
 * Send one text message to a peer. Throws SendMessageError with an honest,
 * mapped reason when the server rejects the write.
 */
export async function sendMessage(
  peerUserId: string,
  myUserId: string,
  keys: PairKeys,
  text: string,
): Promise<void> {
  const theirPk =
    keys.theirIdentityPublicKey.length > 0
      ? keys.theirIdentityPublicKey
      : await fetchPeerIdentityKey(peerUserId);
  const pairKey = derivePairKey(
    keys.myIdentitySecretKey,
    theirPk,
    keys.myIdentityPublicKey,
  );
  const { ciphertext, nonce } = seal(utf8ToBytes(text), pairKey);

  const conversationId = await ensureConversation(peerUserId);
  const { error } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_id: myUserId,
    ciphertext: toPostgrestBytea(ciphertext),
    nonce: toPostgrestBytea(nonce),
  });
  if (error) {
    if (error.code === '42501') {
      conversationCache.delete(peerUserId);
    }
    throw new SendMessageError(error.message, 'insert');
  }
}

/** Load + decrypt the thread for a conversation, oldest first. */
export async function listMessages(
  peerUserId: string,
  myUserId: string,
  keys: PairKeys,
): Promise<ChatMessage[]> {
  const theirPk =
    keys.theirIdentityPublicKey.length > 0
      ? keys.theirIdentityPublicKey
      : await fetchPeerIdentityKey(peerUserId);
  const pairKey = derivePairKey(
    keys.myIdentitySecretKey,
    theirPk,
    keys.myIdentityPublicKey,
  );

  const conversationId = await ensureConversation(peerUserId);
  const { data, error } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_id, ciphertext, nonce, sent_at')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  const rows = (data ?? []) as MessageRow[];
  return rows.map((row) => {
    const plain = open(
      fromPostgrestBytea(row.ciphertext),
      fromPostgrestBytea(row.nonce),
      pairKey,
    );
    return {
      id: row.id,
      senderId: row.sender_id,
      body: plain ? bytesToUtf8(plain) : '',
      sentAt: row.sent_at,
      undecryptable: !plain,
    } satisfies ChatMessage;
  });
}

/** Live updates for one conversation; returns unsubscribe. */
export function subscribeMessages(
  peerUserId: string,
  conversationId: string,
  onChange: () => void,
): () => void {
  const channel = supabase
    .channel(`messages_${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => {
        const row = payload.new as { conversation_id?: string } | null;
        if (row?.conversation_id === conversationId) {
          onChange();
        }
      },
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

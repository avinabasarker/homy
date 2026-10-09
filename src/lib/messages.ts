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

/**
 * Wipe the per-process conversation cache on logout/account switch.
 * Cache entries are (peerId → conversation id) for the CURRENT account's
 * pairs — a self-chat entry (myId → cid_self) or a peer entry resolve to a
 * DIFFERENT conversation for another account, so a stale entry after an
 * account switch would open the wrong thread (owner smoke-test BUG 1/2).
 */
export function clearConversationCache(): void {
  conversationCache.clear();
}

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

/**
 * Resolve (or create) the conversation for a chat with `peerId`, where
 * peerId === myUserId means SELF-chat ("Saved messages"). Passes the own id
 * explicitly so the server RPC guarantees user_a = user_b = me — never any
 * other conversation row (owner smoke-test BUG 1).
 */
export async function ensureOwnOrPeerConversation(
  peerId: string,
  myUserId: string,
): Promise<string> {
  if (peerId === myUserId) {
    return ensureConversation(myUserId);
  }
  return ensureConversation(peerId);
}

export interface ChatMessage {
  id: string;
  senderId: string;
  body: string;
  sentAt: string;
  /** Set when the message was edited (server column edited_at). */
  editedAt?: string | null;
  /** True when decryption failed (wrong key/tampered) — shown as a placeholder. */
  undecryptable?: boolean;
  /** Hours after sentAt when this message disappears; null/0 = never. */
  disappearHours?: number | null;
}

// ---- Envelope v1 (Phase 6) ----
//
// Message plaintext is a JSON envelope: { v: 1, type, body, disappearHours }.
// Legacy rows (pre-Phase 6) are plain UTF-8 strings — decodePlain handles BOTH:
// it tries the envelope first and falls back to treating the plaintext as the
// body itself, so existing history keeps rendering instead of turning 🔒.
// Reactions and disappearing flags travel INSIDE encrypted payloads — never
// in plaintext columns.

export const ENVELOPE_VERSION = 1;

export type EnvelopeType = 'text' | 'reaction';

export interface Envelope {
  v: number;
  type: EnvelopeType;
  body: string;
  disappearHours?: number | null;
}

function buildEnvelope(body: string, disappearHours: number | null): string {
  const env: Envelope = { v: ENVELOPE_VERSION, type: 'text', body };
  if (disappearHours && disappearHours > 0) {
    env.disappearHours = disappearHours;
  }
  return JSON.stringify(env);
}

/**
 * Decode decrypted plaintext: v:1 envelope → structured fields; anything
 * else (legacy plain string, or garbage) → body text with no extras.
 */
function decodePlain(plain: Uint8Array): {
  body: string;
  disappearHours: number | null;
  isReaction: boolean;
} {
  const text = bytesToUtf8(plain);
  try {
    const parsed = JSON.parse(text) as Partial<Envelope> | null;
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.v === ENVELOPE_VERSION &&
      typeof parsed.body === 'string'
    ) {
      return {
        body: parsed.body,
        disappearHours:
          typeof parsed.disappearHours === 'number' && parsed.disappearHours > 0
            ? parsed.disappearHours
            : null,
        isReaction: parsed.type === 'reaction',
      };
    }
  } catch {
    // Not JSON — legacy plain-string message.
  }
  return { body: text, disappearHours: null, isReaction: false };
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  ciphertext: string;
  nonce: string;
  sent_at: string;
  edited_at?: string | null;
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
  disappearHours: number | null = null,
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
  const { ciphertext, nonce } = seal(utf8ToBytes(buildEnvelope(text, disappearHours)), pairKey);

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
  // Self-chat (peerUserId === myUserId) MUST only ever read the self
  // conversation (owner smoke-test BUG 1) — guard here rather than trusting
  // the caller.
  if (peerUserId === myUserId) {
    peerUserId = myUserId;
  }
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
    .select('id, conversation_id, sender_id, ciphertext, nonce, sent_at, edited_at')
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
    if (!plain) {
      return {
        id: row.id,
        senderId: row.sender_id,
        body: '',
        sentAt: row.sent_at,
        editedAt: row.edited_at ?? null,
        undecryptable: true,
        disappearHours: null,
      } satisfies ChatMessage;
    }
    const decoded = decodePlain(plain);
    return {
      id: row.id,
      senderId: row.sender_id,
      body: decoded.body,
      sentAt: row.sent_at,
      editedAt: row.edited_at ?? null,
      disappearHours: decoded.disappearHours,
      undecryptable: false,
    } satisfies ChatMessage;
  });
}

// ---- Edit + delete for everyone (Phase 6) ----

const EDIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour, mirrors the server policy

export function isEditable(sentAt: string): boolean {
  return Date.now() - new Date(sentAt).getTime() < EDIT_WINDOW_MS;
}

/**
 * Replace the encrypted payload of MY message with a new envelope
 * (server enforces the 1-hour window; a rejection surfaces honestly).
 */
export async function editMessage(
  peerUserId: string,
  myUserId: string,
  keys: PairKeys,
  messageId: string,
  newText: string,
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
  const { ciphertext, nonce } = seal(utf8ToBytes(buildEnvelope(newText, null)), pairKey);
  const { error } = await supabase
    .from('messages')
    .update({ ciphertext: toPostgrestBytea(ciphertext), nonce: toPostgrestBytea(nonce), edited_at: new Date().toISOString() })
    .eq('id', messageId)
    .eq('sender_id', myUserId);
  if (error) {
    if (error.code === '42501') {
      throw new Error('The 1-hour edit window has closed — the server rejected this edit.');
    }
    throw new Error(`Edit failed: ${error.message}`);
  }
}

/** Delete for everyone: hard DELETE of my own row (reactions/receipts cascade). */
export async function deleteMessage(messageId: string, myUserId: string): Promise<void> {
  const { error } = await supabase
    .from('messages')
    .delete()
    .eq('id', messageId)
    .eq('sender_id', myUserId);
  if (error) {
    throw new Error(`Delete failed: ${error.message}`);
  }
}

export interface ThreadPreview {
  /** Decrypted last-message body, or a locked placeholder for undecryptable rows. */
  body: string;
  sentAt: string | null;
  fromMe: boolean;
}

/**
 * Read-only helper for the conversation list (Phase 5): decrypts the last
 * message of each conversation for preview purposes. Uses ONLY existing
 * primitives — no new writes, no schema knowledge beyond messages.ts's own.
 */
export async function listLastMessages(
  peerIds: string[],
  myUserId: string,
  keys: PairKeys,
  hiddenIds: Set<string> = new Set(),
): Promise<Map<string, ThreadPreview>> {
  // Guard: a self-chat preview reads the self conversation with the self key
  // only — never another conversation (owner smoke-test BUG 1).
  const map = new Map<string, ThreadPreview>();
  if (peerIds.length === 0) {
    return map;
  }
  await Promise.all(
    peerIds.map(async (peerId) => {
      try {
        // Locally hidden rows ("Delete for me") also vanish from previews.
        const thread = (await listMessages(peerId, myUserId, keys)).filter(
          (m) => !hiddenIds.has(m.id),
        );
        const last = thread[thread.length - 1];
        if (!last) {
          map.set(peerId, { body: '', sentAt: null, fromMe: false });
        } else {
          map.set(peerId, {
            body: last.undecryptable ? '🔒 Encrypted message' : last.body,
            sentAt: last.sentAt,
            fromMe: last.senderId === myUserId,
          });
        }
      } catch {
        // Preview is decorative — a failed conversation never breaks the list.
        map.set(peerId, { body: '', sentAt: null, fromMe: false });
      }
    }),
  );
  return map;
}

// ---- Reactions (Phase 6) — sealed inside the encrypted payload ----

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

export interface MessageReaction {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
}

interface ReactionRow {
  id: string;
  message_id: string;
  user_id: string;
  ciphertext: string;
  nonce: string;
}

function sealReaction(emoji: string, pairKey: Uint8Array): { ciphertext: string; nonce: string } {
  const env: Envelope = { v: ENVELOPE_VERSION, type: 'reaction', body: emoji };
  const sealed = seal(utf8ToBytes(JSON.stringify(env)), pairKey);
  return { ciphertext: toPostgrestBytea(sealed.ciphertext), nonce: toPostgrestBytea(sealed.nonce) };
}

/**
 * Set MY reaction on a message. Upsert semantics server-side: one reaction
 * per (message, user) — tapping the same emoji again toggles it OFF.
 */
export async function setReaction(
  peerUserId: string,
  myUserId: string,
  keys: PairKeys,
  messageId: string,
  conversationId: string,
  emoji: string,
): Promise<void> {
  const theirPk =
    keys.theirIdentityPublicKey.length > 0
      ? keys.theirIdentityPublicKey
      : await fetchPeerIdentityKey(peerUserId);
  const pairKey = derivePairKey(keys.myIdentitySecretKey, theirPk, keys.myIdentityPublicKey);

  const existing = await supabase
    .from('message_reactions')
    .select('id, ciphertext, nonce')
    .eq('message_id', messageId)
    .eq('user_id', myUserId)
    .maybeSingle();
  if (existing.error && existing.error.code !== 'PGRST116') {
    throw new Error(`Could not read existing reaction: ${existing.error.message}`);
  }
  const prior = (existing.data as { id: string; ciphertext: string; nonce: string } | null) ?? null;

  if (prior) {
    // Same emoji again → toggle off (delete). Owner smoke-test BUG 4: a
    // DIFFERENT emoji replaces in ONE tap — delete then insert (never an
    // update; unique(message_id, user_id) blocks a second row, and RLS
    // allows own-delete + own-insert, so no policy change is needed).
    const plain = open(fromPostgrestBytea(prior.ciphertext), fromPostgrestBytea(prior.nonce), pairKey);
    if (plain && decodePlain(plain).body === emoji) {
      const del = await supabase.from('message_reactions').delete().eq('id', prior.id).eq('user_id', myUserId);
      if (del.error) {
        throw new Error(`Could not remove reaction: ${del.error.message}`);
      }
      return;
    }
    const del = await supabase
      .from('message_reactions')
      .delete()
      .eq('id', prior.id)
      .eq('user_id', myUserId);
    if (del.error) {
      throw new Error(`Could not change reaction: ${del.error.message}`);
    }
    const sealed = sealReaction(emoji, pairKey);
    const ins = await supabase.from('message_reactions').insert({
      message_id: messageId,
      conversation_id: conversationId,
      user_id: myUserId,
      ...sealed,
    });
    if (ins.error) {
      throw new Error(`Could not change reaction: ${ins.error.message}`);
    }
    return;
  }

  const sealed = sealReaction(emoji, pairKey);
  const ins = await supabase.from('message_reactions').insert({
    message_id: messageId,
    conversation_id: conversationId,
    user_id: myUserId,
    ...sealed,
  });
  if (ins.error) {
    throw new Error(`Could not react: ${ins.error.message}`);
  }
}

/** All reactions for one conversation, decrypted. Failures drop silently. */
export async function listReactions(
  peerUserId: string,
  myUserId: string,
  keys: PairKeys,
  conversationId: string,
): Promise<MessageReaction[]> {
  const theirPk =
    keys.theirIdentityPublicKey.length > 0
      ? keys.theirIdentityPublicKey
      : await fetchPeerIdentityKey(peerUserId);
  const pairKey = derivePairKey(keys.myIdentitySecretKey, theirPk, keys.myIdentityPublicKey);

  const { data, error } = await supabase
    .from('message_reactions')
    .select('id, message_id, user_id, ciphertext, nonce')
    .eq('conversation_id', conversationId);
  if (error) {
    throw new Error(error.message);
  }
  const out: MessageReaction[] = [];
  for (const row of (data ?? []) as ReactionRow[]) {
    const plain = open(fromPostgrestBytea(row.ciphertext), fromPostgrestBytea(row.nonce), pairKey);
    if (!plain) {
      continue; // undecryptable reaction (e.g. forged/tampered) — skip
    }
    const decoded = decodePlain(plain);
    if (!decoded.isReaction) {
      continue;
    }
    out.push({ id: row.id, messageId: row.message_id, userId: row.user_id, emoji: decoded.body });
  }
  return out;
}

/** Realtime INSERT/DELETE on message_reactions for one conversation. */
export function subscribeReactions(
  conversationId: string,
  onChange: () => void,
): () => void {
  const channel = supabase
    .channel(`reactions_${conversationId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'message_reactions' },
      () => onChange(),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

// ---- Typing (Phase 6) ----

export const TYPING_STALE_MS = 10_000;

export interface TypingEventRow {
  user_id: string;
  typing: boolean;
  updated_at: string;
}

/** Publish my typing state for a conversation (upsert, own row only). */
export async function publishTyping(
  conversationId: string,
  myUserId: string,
  typing: boolean,
): Promise<void> {
  const { error } = await supabase.from('typing_events').upsert(
    { conversation_id: conversationId, user_id: myUserId, typing, updated_at: new Date().toISOString() },
    { onConflict: 'conversation_id,user_id' },
  );
  if (error) {
    // Typing is decorative — never break the chat over it.
    return;
  }
}

/** Realtime updates on typing_events for one conversation. */
export function subscribeTyping(
  conversationId: string,
  onChange: () => void,
): () => void {
  const channel = supabase
    .channel(`typing_${conversationId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'typing_events' },
      () => onChange(),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

/** Peer typing state, with stale-row expiry handled by the caller's clock. */
export async function listTypingPeers(
  conversationId: string,
  myUserId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('typing_events')
    .select('user_id, typing, updated_at')
    .eq('conversation_id', conversationId)
    .neq('user_id', myUserId);
  if (error) {
    return false;
  }
  const now = Date.now();
  return ((data ?? []) as TypingEventRow[]).some(
    (row) => row.typing && now - new Date(row.updated_at).getTime() < TYPING_STALE_MS,
  );
}

// ---- Read receipts (Phase 6) ----

export interface ReceiptRow {
  message_id: string;
  reader_id: string;
  read_at: string;
}

/** Insert receipts (reader = me) for the given message ids. Idempotent-ish: unique(message_id, reader_id) */
export async function markMessagesRead(
  conversationId: string,
  myUserId: string,
  messageIds: string[],
): Promise<void> {
  if (messageIds.length === 0) {
    return;
  }
  const { error } = await supabase.from('read_receipts').insert(
    messageIds.map((id) => ({
      message_id: id,
      conversation_id: conversationId,
      reader_id: myUserId,
    })),
  );
  // Unique-violation (already read) is fine; anything else is decorative too.
  if (error && error.code !== '23505') {
    return;
  }
}

/** Message ids of MINE that the peer has read, with the peer's read time
 *  (ITEM 3: the Seen label renders the relative read time). */
export async function listReadByPeerLatest(
  conversationId: string,
  myUserId: string,
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('read_receipts')
    .select('message_id, reader_id, read_at')
    .eq('conversation_id', conversationId);
  if (error) {
    return new Map();
  }
  // A receipt counts when the READER is not me (i.e. the peer read my message).
  const out = new Map<string, string>();
  for (const row of (data ?? []) as ReceiptRow[]) {
    if (row.reader_id !== myUserId) {
      out.set(row.message_id, row.read_at);
    }
  }
  return out;
}

/** Realtime INSERT on read_receipts for one conversation. */
export function subscribeReceipts(
  conversationId: string,
  onChange: () => void,
): () => void {
  const channel = supabase
    .channel(`receipts_${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'read_receipts' },
      () => onChange(),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
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
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages' },
      (payload) => {
        const row = payload.new as { conversation_id?: string } | null;
        if (row?.conversation_id === conversationId) {
          onChange();
        }
      },
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'messages' },
      (payload) => {
        const row = (payload as { old?: { conversation_id?: string } | null }).old ?? null;
        // DELETE payloads only carry the primary key — refetch is harmless
        // even when the conversation id is absent from the payload.
        if (!row || !row.conversation_id || row.conversation_id === conversationId) {
          onChange();
        }
      },
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

// social.ts — Phase 3 social graph (Part B Phase 3, Part D2).
// - Add by exact username; RLS makes the server the authority.
// - This file NEVER touches key material and never logs anything sensitive.
// - Presence failures never break the contacts list (best-effort, Part H #10).
import '../../polyfills';

import { supabase } from './supabase';

// ---- Types ----

export type RequestDirection = 'incoming' | 'outgoing';

export interface FriendRequest {
  id: string;
  direction: RequestDirection;
  otherUserId: string;
  otherUsername: string;
  createdAt: string;
}

export interface Contact {
  userId: string;
  username: string;
  addedAt: string;
  online: boolean;
  lastSeen: string | null;
}

export type AddFriendResult =
  | { kind: 'sent' }
  | { kind: 'accepted' }
  | { kind: 'error'; message: string };

// ---- Errors surfaced to the UI (mapped, never raw dumps) ----

const ERROR_MESSAGES = {
  self: 'You cannot add yourself.',
  notFound: 'No user with that username.',
  duplicateOutgoing: 'Request already sent.',
  duplicateIncoming: 'This user already sent you a request — accept it below.',
  duplicateContacts: 'You are already contacts.',
  network:
    'You are offline, or the Supabase project is paused. Check your connection.',
} as const;

function friendlyError(message: string): string {
  if (message.includes('Failed to fetch') || message.includes('Network request failed')) {
    return ERROR_MESSAGES.network;
  }
  if (message.includes('duplicate key') || message.includes('already exists')) {
    return ERROR_MESSAGES.duplicateContacts;
  }
  return message;
}

// ---- Row shapes (server column names) ----

interface ProfileRow {
  id: string;
  username: string;
}

interface RequestRow {
  id: string;
  sender_id: string;
  recipient_id: string;
  created_at: string;
}

interface ContactRow {
  user_id: string;
  contact_id: string;
  created_at: string;
}

interface PresenceRow {
  user_id: string;
  online: boolean;
  last_seen: string | null;
}

// ---- Small helpers ----

async function fetchProfilesByIds(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) {
    return map;
  }
  const { data, error } = await supabase.from('profiles').select('id, username').in('id', ids);
  if (error) {
    throw new Error(friendlyError(error.message));
  }
  for (const row of (data ?? []) as ProfileRow[]) {
    map.set(row.id, row.username);
  }
  return map;
}

async function fetchPresenceFor(userIds: string[]): Promise<Map<string, PresenceRow>> {
  const map = new Map<string, PresenceRow>();
  if (userIds.length === 0) {
    return map;
  }
  const { data, error } = await supabase.from('presence').select('user_id, online, last_seen').in('user_id', userIds);
  if (error) {
    // Presence is best-effort decoration (Part H #10) — never fail the list.
    return map;
  }
  for (const row of (data ?? []) as PresenceRow[]) {
    map.set(row.user_id, row);
  }
  return map;
}

// ---- Queries ----

export async function findProfileByUsername(username: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username')
    .eq('username', username)
    .maybeSingle();
  if (error) {
    throw new Error(friendlyError(error.message));
  }
  return (data as ProfileRow | null) ?? null;
}

/** Every non-accepted request involving me, both directions. */
export async function listFriendRequests(userId: string): Promise<FriendRequest[]> {
  const { data, error } = await supabase
    .from('friend_requests')
    .select('id, sender_id, recipient_id, created_at')
    .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(friendlyError(error.message));
  }
  const rows = (data ?? []) as RequestRow[];
  const otherIds = rows.map((r) => (r.sender_id === userId ? r.recipient_id : r.sender_id));
  const names = await fetchProfilesByIds(otherIds);
  return rows
    .filter((row) => row.sender_id !== row.recipient_id)
    .map((row) => {
      const outgoing = row.sender_id === userId;
      const otherId = outgoing ? row.recipient_id : row.sender_id;
      return {
        id: row.id,
        direction: outgoing ? 'outgoing' : 'incoming',
        otherUserId: otherId,
        otherUsername: names.get(otherId) ?? 'unknown',
        createdAt: row.created_at,
      } satisfies FriendRequest;
    });
}

export async function listContacts(userId: string): Promise<Contact[]> {
  const { data, error } = await supabase
    .from('contacts')
    .select('user_id, contact_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(friendlyError(error.message));
  }
  const rows = (data ?? []) as ContactRow[];
  const otherIds = rows.map((r) => r.contact_id);
  const [names, presence] = await Promise.all([
    fetchProfilesByIds(otherIds),
    fetchPresenceFor(otherIds),
  ]);
  return rows.map((row) => ({
    userId: row.contact_id,
    username: names.get(row.contact_id) ?? 'unknown',
    addedAt: row.created_at,
    online: presence.get(row.contact_id)?.online ?? false,
    lastSeen: presence.get(row.contact_id)?.last_seen ?? null,
  }));
}

/** Anything pending involving `otherUserId` (either direction). */
export async function findPendingRequest(
  userId: string,
  otherUserId: string,
): Promise<FriendRequest | null> {
  const all = await listFriendRequests(userId);
  return all.find((r) => r.otherUserId === otherUserId) ?? null;
}

export async function areContacts(userId: string, otherUserId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('contacts')
    .select('user_id')
    .eq('user_id', userId)
    .eq('contact_id', otherUserId)
    .maybeSingle();
  if (error) {
    throw new Error(friendlyError(error.message));
  }
  return data != null;
}

// ---- Mutations ----

export async function sendFriendRequest(
  userId: string,
  rawUsername: string,
): Promise<AddFriendResult> {
  const username = rawUsername.trim().toLowerCase();
  // 0) Validate locally so we never hit the network for garbage.
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return {
      kind: 'error',
      message: 'Usernames are 3–20 characters: a-z, 0-9, underscore.',
    };
  }
  try {
    // 1) Resolve the profile by EXACT username (Part B Phase 3).
    const target = await findProfileByUsername(username);
    if (!target) {
      return { kind: 'error', message: ERROR_MESSAGES.notFound };
    }
    if (target.id === userId) {
      return { kind: 'error', message: ERROR_MESSAGES.self };
    }

    // 2) Already contacts?
    if (await areContacts(userId, target.id)) {
      return { kind: 'error', message: ERROR_MESSAGES.duplicateContacts };
    }

    // 3) Pending either direction? (duplicate + inverse protection)
    const pending = await findPendingRequest(userId, target.id);
    if (pending?.direction === 'incoming') {
      // A plus B: I add them while their request to me is still pending —
      // accept mine-on-their-side by creating contacts now.
      return { kind: 'accepted' };
    }
    if (pending?.direction === 'outgoing') {
      return { kind: 'error', message: ERROR_MESSAGES.duplicateOutgoing };
    }

    // 4) Insert the request. A UNIQUE constraint lands here as error.code
    //    23505 — re-classify which way the duplicate went.
    const { error } = await supabase.from('friend_requests').insert({
      sender_id: userId,
      recipient_id: target.id,
      status: 'pending',
    });
    if (error) {
      if (error.code === '23505') {
        const again = await findPendingRequest(userId, target.id);
        if (again?.direction === 'incoming') {
          return { kind: 'accepted' };
        }
        return { kind: 'error', message: ERROR_MESSAGES.duplicateOutgoing };
      }
      return { kind: 'error', message: friendlyError(error.message) };
    }
    return { kind: 'sent' };
  } catch (err) {
    return { kind: 'error', message: (err as Error).message };
  }
}

export async function acceptFriendRequest(
  userId: string,
  requestId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  // RLS lets us read requests where we are the recipient.
  const { data: req, error: reqError } = await supabase
    .from('friend_requests')
    .select('id, sender_id, recipient_id')
    .eq('id', requestId)
    .maybeSingle();
  if (reqError) {
    return { ok: false, message: friendlyError(reqError.message) };
  }
  const row = req as { id: string; sender_id: string; recipient_id: string } | null;
  if (!row) {
    return { ok: false, message: 'That request no longer exists.' };
  }
  if (row.recipient_id !== userId) {
    return { ok: false, message: 'You can only accept requests sent to you.' };
  }

  // Symmetric pair — RLS must allow inserting OUR row (and ideally the
  // mirror row; if the mirror is blocked the trigger/second edge handles it).
  const { error } = await supabase.from('contacts').insert([
    { user_id: userId, contact_id: row.sender_id },
    { user_id: row.sender_id, contact_id: userId },
  ]);
  if (error) {
    // If the pair insert failed only because of OUR row's constraint, we
    // still delete nothing — surface the reason to the owner test.
    return { ok: false, message: friendlyError(error.message) };
  }

  await supabase.from('friend_requests').delete().eq('id', requestId);
  return { ok: true };
}

export async function rejectFriendRequest(requestId: string): Promise<void> {
  const { error } = await supabase.from('friend_requests').delete().eq('id', requestId);
  if (error) {
    throw new Error(friendlyError(error.message));
  }
}

// ---- Realtime (Part B Phase 3: live subscription on friend_requests) ----

/**
 * Subscribe to friend_requests changes involving me; returns unsubscribe.
 * Note: Realtime RLS filters to rows the session can see (sender or recipient),
 * so no other users' traffic arrives here.
 */
export function subscribeFriendRequests(userId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`friend_requests_${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'friend_requests' },
      (payload) => {
        const newRow = payload.new as { sender_id?: string; recipient_id?: string } | null;
        const oldRow = payload.old as { sender_id?: string; recipient_id?: string } | null;
        const involved =
          newRow?.sender_id === userId ||
          newRow?.recipient_id === userId ||
          oldRow?.sender_id === userId ||
          oldRow?.recipient_id === userId;
        // Non-involved traffic cannot arrive through the RLS-filtered
        // subscription, but belt-and-suspenders: ignore it if it ever does.
        if (involved) {
          onChange();
        }
      },
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

/** Subscribe to presence changes; returns unsubscribe. */
export function subscribePresence(onChange: () => void): () => void {
  const channel = supabase
    .channel('presence_watch')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'presence' },
      () => onChange(),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

// social.ts — Phase 3 social graph data layer.
//
// Server model (verified against the live database with two real sessions):
// - friend_requests(id, requester_id, recipient_id, status, created_at,
//   updated_at); status is only ever 'pending' or 'accepted'.
// - Self-requests are RLS-blocked at the DB (42501) — defense in depth.
// - "Contacts" are derived client-side from accepted requests involving me.
// - RLS: a signed-in user sees only request rows where they are requester or
//   recipient; unreadable rows never leak.
// - Presence and profiles are read-only decorations; their failures never
//   break the lists.
//
// This file never touches key material and never logs anything sensitive.
import '../../polyfills';

import { supabase } from './supabase';

// ---- Types ----

export type RequestDirection = 'incoming' | 'outgoing';

export interface FriendRequest {
  id: string;
  direction: RequestDirection;
  otherUserId: string;
  otherUsername: string;
  status: string;
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
  | { kind: 'error'; message: string };

// ---- Mapped error messages (never raw DB dumps) ----

const ERRORS = {
  self: 'You cannot add yourself.',
  notFound: 'No user with that username.',
  outgoing: 'You already sent them a request.',
  incoming: 'They already sent you a request — accept it below.',
  contacts: 'You are already contacts.',
  network:
    'You are offline, or the Supabase project is paused. Check your connection.',
} as const;

function friendlyError(message: string): string {
  if (message.includes('Failed to fetch') || message.includes('Network request failed')) {
    return ERRORS.network;
  }
  return message;
}

// ---- Row shapes (server column names, verified) ----

interface RequestRow {
  id: string;
  requester_id: string;
  recipient_id: string;
  status: string;
  created_at: string;
}

interface ProfileRow {
  id: string;
  username: string;
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
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username')
    .in('id', ids);
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
  const { data, error } = await supabase
    .from('presence')
    .select('user_id, online, last_seen')
    .in('user_id', userIds);
  if (error) {
    return map; // best-effort (Part H #10)
  }
  for (const row of (data ?? []) as PresenceRow[]) {
    map.set(row.user_id, row);
  }
  return map;
}

function directionOf(row: RequestRow, userId: string): RequestDirection {
  return row.requester_id === userId ? 'outgoing' : 'incoming';
}

function otherOf(row: RequestRow, userId: string): string {
  return row.requester_id === userId ? row.recipient_id : row.requester_id;
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

/** Every request row involving me (both directions, all statuses). */
async function listMyRequests(userId: string): Promise<RequestRow[]> {
  const { data, error } = await supabase
    .from('friend_requests')
    .select('id, requester_id, recipient_id, status, created_at')
    .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(friendlyError(error.message));
  }
  return (data ?? []) as RequestRow[];
}

/** Non-accepted requests involving me, sorted: incoming first. */
export async function listFriendRequests(userId: string): Promise<FriendRequest[]> {
  const rows = (await listMyRequests(userId)).filter((r) => r.status !== 'accepted');
  const names = await fetchProfilesByIds(rows.map((r) => otherOf(r, userId)));
  return rows.map((row) => {
    const otherId = otherOf(row, userId);
    return {
      id: row.id,
      direction: directionOf(row, userId),
      otherUserId: otherId,
      otherUsername: names.get(otherId) ?? 'unknown',
      status: row.status,
      createdAt: row.created_at,
    } satisfies FriendRequest;
  });
}

/** Contacts = the OTHER party of every accepted request involving me. */
export async function listContacts(userId: string): Promise<Contact[]> {
  const accepted = (await listMyRequests(userId)).filter((r) => r.status === 'accepted');
  const otherIds = accepted.map((r) => otherOf(r, userId));
  const [names, presence] = await Promise.all([
    fetchProfilesByIds(otherIds),
    fetchPresenceFor(otherIds),
  ]);
  return accepted.map((row) => {
    const otherId = otherOf(row, userId);
    const pres = presence.get(otherId);
    return {
      userId: otherId,
      username: names.get(otherId) ?? 'unknown',
      addedAt: row.created_at,
      online: pres?.online ?? false,
      lastSeen: pres?.last_seen ?? null,
    } satisfies Contact;
  });
}

/**
 * Snapshot of my relationship with one user, resolved in ONE pass so the
 * add-friend flow covers every branch (duplicate/self/already-contacts).
 */
export async function findExistingRequest(
  userId: string,
  otherUserId: string,
): Promise<FriendRequest | null> {
  const rows = await listMyRequests(userId);
  const found = rows.find((r) => otherOf(r, userId) === otherUserId);
  if (!found) {
    return null;
  }
  const names = await fetchProfilesByIds([otherUserId]);    return {
      id: found.id,
      direction: directionOf(found, userId),
      otherUserId,
      otherUsername: names.get(otherUserId) ?? 'unknown',
      status: found.status,
      createdAt: found.created_at,
    };
}

// ---- Mutations ----

export async function sendFriendRequest(
  userId: string,
  rawUsername: string,
): Promise<AddFriendResult> {
  const username = rawUsername.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return {
      kind: 'error',
      message: 'Usernames are 3–20 characters: a-z, 0-9, underscore.',
    };
  }
  try {
    // 1) Resolve the profile by EXACT username.
    const target = await findProfileByUsername(username);
    if (!target) {
      return { kind: 'error', message: ERRORS.notFound };
    }
    if (target.id === userId) {
      return { kind: 'error', message: ERRORS.self };
    }

    // 2) Any existing row with this user settles every branch.
    const existing = await findExistingRequest(userId, target.id);
    if (existing) {
      return {
        kind: 'error',
        message:
          existing.direction === 'incoming' ? ERRORS.incoming : ERRORS.outgoing,
      };
    }
  // NOTE: accepted pairs are filtered out of listFriendRequests; the 42501
  // race branch below re-classifies an accepted pair as ERRORS.contacts.

    // 3) Insert. RLS verifies the relationship server-side; a bogus target
    //    that slipped past step 1 is rejected with 42501.
    const { error } = await supabase.from('friend_requests').insert({
      requester_id: userId,
      recipient_id: target.id,
      status: 'pending',
    });
    if (error) {
      if (error.code === '42501') {
        // Most likely race: the row appeared between our list read and the
        // insert; re-classify the relationship and return a precise message.
        const race = await findExistingRequest(userId, target.id);
        if (race) {
          return {
            kind: 'error',
            message:
              race.status === 'accepted'
                ? ERRORS.contacts
                : race.direction === 'incoming'
                  ? ERRORS.incoming
                  : ERRORS.outgoing,
          };
        }
        return { kind: 'error', message: ERRORS.notFound };
      }
      return { kind: 'error', message: friendlyError(error.message) };
    }
    return { kind: 'sent' };
  } catch (err) {
    return { kind: 'error', message: (err as Error).message };
  }
}

/** Recipient upgrades the request to accepted. Verified live (2 sessions). */
export async function acceptFriendRequest(
  userId: string,
  requestId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: row, error: readErr } = await supabase
    .from('friend_requests')
    .select('id, requester_id, recipient_id, status')
    .eq('id', requestId)
    .maybeSingle();
  if (readErr) {
    return { ok: false, message: friendlyError(readErr.message) };
  }
  const req = row as RequestRow | null;
  if (!req) {
    return { ok: false, message: 'That request no longer exists.' };
  }
  if (req.recipient_id !== userId) {
    return { ok: false, message: 'You can only accept requests sent to you.' };
  }
  if (req.status === 'accepted') {
    return { ok: true };
  }
  const { error } = await supabase
    .from('friend_requests')
    .update({ status: 'accepted' })
    .eq('id', requestId);
  if (error) {
    return { ok: false, message: friendlyError(error.message) };
  }
  return { ok: true };
}

/**
 * Recipient rejects; sender withdraws. RLS allows the delete on rows we can
 * see; a stale row is silently tolerated (it is already gone).
 */
export async function removeFriendRequest(requestId: string): Promise<void> {
  const { error } = await supabase
    .from('friend_requests')
    .delete()
    .eq('id', requestId);
  if (error) {
    throw new Error(friendlyError(error.message));
  }
}

// ---- Realtime (Part B Phase 3) ----

/**
 * Live updates for requests involving me. RLS filters the subscription so
 * other users' traffic never arrives; the involved-check is belt-and-braces.
 */
export function subscribeFriendRequests(userId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`friend_requests_${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'friend_requests' },
      (payload) => {
        const newRow = payload.new as RequestRow | null;
        const oldRow = payload.old as RequestRow | null;
        const involved =
          newRow?.requester_id === userId ||
          newRow?.recipient_id === userId ||
          oldRow?.requester_id === userId ||
          oldRow?.recipient_id === userId;
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

/** Live presence for the online dots; always best-effort. */
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

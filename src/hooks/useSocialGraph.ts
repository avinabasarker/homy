// useSocialGraph.ts — one hook that owns the Phase 3 social-graph state:
// pending requests, contacts, add-friend flow, and realtime refresh.
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AddFriendResult, Contact, FriendRequest } from '../lib/social';
import {
  acceptFriendRequest,
  listContacts,
  listFriendRequests,
  removeFriendRequest,
  sendFriendRequest,
  subscribeFriendRequests,
  subscribePresence,
} from '../lib/social';

interface SocialGraphState {
  loading: boolean;
  refreshing: boolean;
  requests: FriendRequest[];
  contacts: Contact[];
  error: string | null;
}

export interface UseSocialGraph extends SocialGraphState {
  accept: (requestId: string) => Promise<void>;
  remove: (requestId: string) => Promise<void>;
  addFriend: (username: string) => Promise<AddFriendResult>;
  refresh: () => Promise<void>;
}

export function useSocialGraph(userId: string | null): UseSocialGraph {
  const [state, setState] = useState<SocialGraphState>({
    loading: true,
    refreshing: false,
    requests: [],
    contacts: [],
    error: null,
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (asRefresh: boolean) => {
      if (!userId) {
        return;
      }
      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: asRefresh,
        error: null,
      }));
      try {
        const [requests, contacts] = await Promise.all([
          listFriendRequests(userId),
          listContacts(userId),
        ]);
        if (!mountedRef.current) {
          return;
        }
        setState((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
          requests,
          contacts,
          error: null,
        }));
      } catch (err) {
        if (!mountedRef.current) {
          return;
        }
        setState((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
          error: (err as Error).message,
        }));
      }
    },
    [userId],
  );

  const refresh = useCallback(async () => {
    await load(true);
  }, [load]);

  // Initial load + resubscribe whenever the signed-in user changes.
  useEffect(() => {
    if (!userId) {
      setState({ loading: false, refreshing: false, requests: [], contacts: [], error: null });
      return undefined;
    }
    void load(false);
    const unsubscribeRequests = subscribeFriendRequests(userId, () => {
      void load(true);
    });
    const unsubscribePresence = subscribePresence(() => {
      void load(true);
    });
    return () => {
      unsubscribeRequests();
      unsubscribePresence();
    };
  }, [userId, load]);

  const accept = useCallback(
    async (requestId: string) => {
      if (!userId) {
        return;
      }
      const result = await acceptFriendRequest(userId, requestId);
      if (!result.ok) {
        setState((prev) => ({ ...prev, error: result.message }));
        return;
      }
      await load(true);
    },
    [userId, load],
  );

  const remove = useCallback(
    async (requestId: string) => {
      await removeFriendRequest(requestId);
      await load(true);
    },
    [load],
  );

  const addFriend = useCallback(
    async (username: string): Promise<AddFriendResult> => {
      if (!userId) {
        return { kind: 'error', message: 'No active session.' };
      }
      const result = await sendFriendRequest(userId, username);
      await load(true); // outgoing list may have changed
      return result;
    },
    [userId, load],
  );

  return { ...state, accept, remove, addFriend, refresh };
}

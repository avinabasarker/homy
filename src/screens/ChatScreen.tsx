import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { Bubble } from '../components/Bubble';
import { EmptyState } from '../components/EmptyState';
import {
  ensureConversation,
  listMessages,
  loadMyIdentityKeys,
  sendMessage,
  subscribeMessages,
} from '../lib/messages';
import type { ChatMessage, PairKeys } from '../lib/messages';
import { fetchPeerIdentityKey } from '../lib/messages';
import { useAuth } from '../state/AuthProvider';
import { colors, fontFamily, spacing } from '../theme/theme';

interface ChatScreenProps {
  peerUserId: string;
  peerUsername: string;
  onBack: () => void;
}

/**
 * Phase 4 chat: E2EE bubbles over the verified messages table.
 * The conversation id is resolved server-side via `ensure_conversation`
 * (never derived client-side).
 */
export function ChatScreen({ peerUserId, peerUsername, onBack }: ChatScreenProps) {
  const { userId } = useAuth();
  const insets = useSafeAreaInsets();
  const [keys, setKeys] = useState<PairKeys | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [revealedTimeId, setRevealedTimeId] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage> | null>(null);
  // Ids present at mount; only messages arriving afterwards animate in.
  const initialIdsRef = useRef<Set<string> | null>(null);
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (!userId) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const mine = await loadMyIdentityKeys(userId);
        if (!mine) {
          throw new Error('Your identity keys are missing on this device. Log out and back in.');
        }
        const theirPk = await fetchPeerIdentityKey(peerUserId);
        const full: PairKeys = { ...mine, theirIdentityPublicKey: theirPk };
        if (cancelled) {
          return;
        }
        setKeys(full);
        const conversationId = await ensureConversation(peerUserId);
        setConversationId(conversationId);
        const thread = await listMessages(peerUserId, userId, full);
        if (cancelled) {
          return;
        }
        initialIdsRef.current = new Set(thread.map((m) => m.id));
        prevCountRef.current = thread.length;
        setMessages(thread);
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, peerUserId]);

  const reload = useCallback(async () => {
    if (!userId || !keys || !conversationId) {
      return;
    }
    try {
      const thread = await listMessages(peerUserId, userId, keys);
      // NEW incoming message while the screen is open → light haptic.
      // NEVER fires for my own sends (senderId === userId) and never on
      // UI clicks. Strictly growing count guards against replays.
      if (
        thread.length > prevCountRef.current &&
        thread[thread.length - 1] &&
        thread[thread.length - 1].senderId !== userId
      ) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      prevCountRef.current = thread.length;
      setMessages(thread);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [userId, keys, conversationId, peerUserId]);

  useEffect(() => {
    if (!keys || !conversationId) {
      return undefined;
    }
    return subscribeMessages(
      peerUserId,
      conversationId,
      () => {
        void reload();
      },
    );
  }, [keys, conversationId, peerUserId, reload]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !userId || !keys || sending) {
      return;
    }
    setSending(true);
    setError(null);
    try {
      await sendMessage(peerUserId, userId, keys, text);
      setDraft('');
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const revealedIdRef = useRef<string | null>(null);
  revealedIdRef.current = revealedTimeId;

  const handleLongPress = useCallback((id: string) => {
    setRevealedTimeId((prev) => (prev === id ? null : id));
  }, []);

  const renderBubble = ({ index }: { index: number }) => {
    const item = messages[index];
    if (!item) {
      return null;
    }
    const mine = item.senderId === userId;
    const prev = index > 0 ? messages[index - 1] : undefined;
    // Grouping: consecutive bubbles from the same sender; only the LAST
    // bubble of a group carries the tail.
    const lastOfGroup = !messages[index + 1] || messages[index + 1].senderId !== item.senderId;
    const animate = !(initialIdsRef.current?.has(item.id) ?? false);
    return (
      <Bubble
        item={item}
        mine={mine}
        lastOfGroup={lastOfGroup}
        animate={animate}
        showTime={revealedIdRef.current === item.id}
        onLongPress={handleLongPress}
      />
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'android' ? undefined : 'padding'}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable accessibilityLabel="Go back" onPress={onBack} hitSlop={12}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.headerMain}>
          <Text style={styles.headerTitle}>{peerUsername}</Text>
          <Text style={styles.headerSub}>End-to-end encrypted</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : messages.length === 0 && !error ? (
        <EmptyState />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderBubble}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        />
      )}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={[styles.composer, { paddingBottom: insets.bottom + spacing.sm }]}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          placeholderTextColor={colors.textSecondary}
          multiline
          editable={!sending}
        />
        <Pressable
          accessibilityLabel="Send message"
          onPress={() => void handleSend()}
          disabled={!draft.trim() || sending}
          style={({ pressed }) => [
            styles.sendButton,
            (!draft.trim() || sending) && styles.sendDisabled,
            pressed && styles.sendPressed,
          ]}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.sendText}>Send</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backText: {
    color: colors.accent,
    fontSize: 32,
    fontFamily: fontFamily.semiBold,
    marginTop: -4,
  },
  headerMain: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: fontFamily.semiBold,
    color: colors.text,
  },
  headerSub: {
    fontSize: 11,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 15,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  bubbleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  bubbleRowMine: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginVertical: 2,
  },
  bubbleMine: {
    backgroundColor: colors.accent,
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    fontSize: 15,
    fontFamily: fontFamily.regular,
    color: colors.text,
  },
  bubbleTime: {
    fontSize: 11,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
    alignSelf: 'flex-end',
    marginTop: 2,
  },
  errorText: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    fontSize: 12,
    fontFamily: fontFamily.regular,
    color: '#B84A4A',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 15,
    fontFamily: fontFamily.regular,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    maxHeight: 120,
  },
  sendButton: {
    backgroundColor: colors.accent,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  sendPressed: {
    opacity: 0.85,
  },
  sendDisabled: {
    opacity: 0.5,
  },
  sendText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: fontFamily.semiBold,
  },
});

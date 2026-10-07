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

import {
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
  conversationId: string;
  peerUserId: string;
  peerUsername: string;
  onBack: () => void;
}

/**
 * Phase 4 chat: E2EE bubbles over the verified messages table.
 * The conversation id currently maps to the ACCEPTED friend-request row
 * (server has no reachable conversation-creation path — see PROGRESS.md).
 */
export function ChatScreen({ conversationId, peerUserId, peerUsername, onBack }: ChatScreenProps) {
  const { userId } = useAuth();
  const insets = useSafeAreaInsets();
  const [keys, setKeys] = useState<PairKeys | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatMessage> | null>(null);

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
        const thread = await listMessages(conversationId, peerUserId, userId, full);
        if (cancelled) {
          return;
        }
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
  }, [userId, conversationId, peerUserId]);

  const reload = useCallback(async () => {
    if (!userId || !keys) {
      return;
    }
    try {
      const thread = await listMessages(conversationId, peerUserId, userId, keys);
      setMessages(thread);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [userId, keys, conversationId, peerUserId]);

  useEffect(() => {
    if (!keys) {
      return undefined;
    }
    return subscribeMessages(conversationId, () => {
      void reload();
    });
  }, [keys, conversationId, reload]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !userId || !keys || sending) {
      return;
    }
    setSending(true);
    setError(null);
    try {
      await sendMessage(conversationId, peerUserId, userId, keys, text);
      setDraft('');
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const renderBubble = ({ item }: { item: ChatMessage }) => {
    const mine = item.senderId === userId;
    return (
      <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : null]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
          <Text style={styles.bubbleText}>
            {item.undecryptable ? '🔒 Encrypted message' : item.body}
          </Text>
          <Text style={styles.bubbleTime}>
            {new Date(item.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>
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
        <View style={styles.center}>
          <Text style={styles.emptyText}>No messages yet. Say Hi!</Text>
        </View>
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

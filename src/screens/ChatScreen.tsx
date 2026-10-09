import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Bubble } from '../components/Bubble';
import { EmptyState } from '../components/EmptyState';
import {
  deleteMessage,
  editMessage,
  ensureOwnOrPeerConversation,
  isEditable,
  listMessages,
  listReadByPeerLatest,
  listReactions,
  listTypingPeers,
  loadMyIdentityKeys,
  markMessagesRead,
  publishTyping,
  sendMessage,
  setReaction,
  subscribeMessages,
  subscribeReceipts,
  subscribeReactions,
  subscribeTyping,
  REACTION_EMOJIS,
} from '../lib/messages';
import type { ChatMessage, PairKeys } from '../lib/messages';
import { fetchPeerIdentityKey } from '../lib/messages';
import { hideMessageLocally, listHiddenMessageIds } from '../lib/hiddenMessages';
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
  const [reactions, setReactions] = useState<Map<string, Map<string, string>>>(new Map());
  // ITEM 3: messageId → the PEER's read_at (ISO), only receipts by the peer.
  const [readIds, setReadIds] = useState<Map<string, string>>(new Map());
  // 30s tick so "Seen just now" rolls over to "Seen 1m ago" while watching.
  const [seenTick, setSeenTick] = useState(0);
  const [peerTyping, setPeerTyping] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [disappearHours, setDisappearHours] = useState<number | null>(null);
  const [showDisappearMenu, setShowDisappearMenu] = useState(false);
  // Owner smoke-test BUG 5: ids hidden via "Delete for me" — filtered out of
  // every thread query, LOCAL-ONLY (the row stays on the server for the peer).
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const typingIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<FlatList<ChatMessage> | null>(null);
  // Ids present at mount; only messages arriving afterwards animate in.
  const initialIdsRef = useRef<Set<string> | null>(null);
  const prevCountRef = useRef(0);

  // ITEM 3: the Seen label live-rolls over ("just now" → "1m ago") while
  // the screen is open — bump the label's tick every 30 seconds.
  useEffect(() => {
    const timer = setInterval(() => setSeenTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

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
        // Self-chat (peerUserId === userId) always resolves via the own-id
        // RPC path so it can never bind to another conversation row (BUG 1).
        const conversationId = await ensureOwnOrPeerConversation(peerUserId, userId);
        setConversationId(conversationId);
        // BUG 2 gate: history loads HERE, on open — sending is never a
        // prerequisite. Hidden ids (BUG 5) are filtered out of the first
        // render too.
        const [thread, hidden] = await Promise.all([
          listMessages(peerUserId, userId, full),
          listHiddenMessageIds().catch(() => new Set<string>()),
        ]);
        if (cancelled) {
          return;
        }
        setHiddenIds(hidden);
        initialIdsRef.current = new Set(
          thread.filter((m) => !hidden.has(m.id)).map((m) => m.id),
        );
        prevCountRef.current = thread.length;
        setMessages(thread.filter((m) => !hidden.has(m.id)));
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
      const [thread, reactionList, readSet, typing, hidden] = await Promise.all([
        listMessages(peerUserId, userId, keys),
        listReactions(peerUserId, userId, keys, conversationId).catch(() => []),
        listReadByPeerLatest(conversationId, userId).catch(() => new Map<string, string>()),
        listTypingPeers(conversationId, userId).catch(() => false),
        listHiddenMessageIds().catch(() => new Set<string>()),
      ]);
      // NEW incoming message while the screen is open → light haptic.
      if (
        thread.length > prevCountRef.current &&
        thread[thread.length - 1] &&
        thread[thread.length - 1].senderId !== userId
      ) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      prevCountRef.current = thread.length;
      setHiddenIds(hidden);
      const byMessage = new Map<string, Map<string, string>>();
      for (const r of reactionList) {
        let m = byMessage.get(r.messageId);
        if (!m) {
          m = new Map();
          byMessage.set(r.messageId, m);
        }
        m.set(r.userId, r.emoji);
      }
      setReactions(byMessage);
      setReadIds(readSet);
      setPeerTyping(typing);
      setSeenTick((t) => t + 1);
      // Owner smoke-test BUG 5: locally hidden rows never render. The server
      // row stays untouched — the peer still sees the message.
      setMessages(thread.filter((m) => !hidden.has(m.id)));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [userId, keys, conversationId, peerUserId]);

  useEffect(() => {
    if (!keys || !conversationId) {
      return undefined;
    }
    const unsubMessages = subscribeMessages(peerUserId, conversationId, () => {
      void reload();
    });
    const unsubReactions = subscribeReactions(conversationId, () => {
      void reload();
    });
    const unsubReceipts = subscribeReceipts(conversationId, () => {
      void reload();
    });
    const unsubTyping = subscribeTyping(conversationId, () => {
      void listTypingPeers(conversationId, userId ?? '').then(setPeerTyping).catch(() => {});
    });
    return () => {
      unsubMessages();
      unsubReactions();
      unsubReceipts();
      unsubTyping();
    };
  }, [keys, conversationId, peerUserId, userId, reload]);

  // ---- Typing: publish true (debounced 2s), false after 3s idle / on send ----
  const handleDraftChange = (text: string) => {
    setDraft(text);
    if (!userId || !conversationId || editingId) {
      return;
    }
    if (typingIdleRef.current) {
      clearTimeout(typingIdleRef.current);
      typingIdleRef.current = null;
    }
    if (text.trim().length === 0) {
      void publishTyping(conversationId, userId, false);
      return;
    }
    typingIdleRef.current = setTimeout(() => {
      typingIdleRef.current = null;
      if (userId && conversationId) {
        void publishTyping(conversationId, userId, true);
        // Auto-clear after 3s idle.
        typingIdleRef.current = setTimeout(() => {
          typingIdleRef.current = null;
          if (userId && conversationId) {
            void publishTyping(conversationId, userId, false);
          }
        }, 3000);
      }
    }, 2000);
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !userId || !keys || !conversationId || sending) {
      return;
    }
    setSending(true);
    setError(null);
    try {
      if (typingIdleRef.current) {
        clearTimeout(typingIdleRef.current);
        typingIdleRef.current = null;
      }
      void publishTyping(conversationId, userId, false);
      if (editingId) {
        const target = messages.find((m) => m.id === editingId);
        if (!target) {
          setError('The message being edited no longer exists.');
          return;
        }
        if (!isEditable(target.sentAt)) {
          setError('The 15-minute edit window has closed for that message.');
          return;
        }
        await editMessage(peerUserId, userId, keys, editingId, text);
        setEditingId(null);
      } else {
        await sendMessage(peerUserId, userId, keys, text, disappearHours);
      }
      setDraft('');
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  /** Owner smoke-test BUG 5: Delete asks first. "Delete for everyone" is a
   *  server DELETE (row gone for both, no tombstone); "Delete for me" is a
   *  LOCAL-only hide (server row untouched — the peer still sees it). */
  const confirmDelete = (id: string) => {
    setActionId(null);
    Alert.alert(
      'Delete message',
      'Delete for everyone removes it from the conversation. Delete for me removes it only from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete for everyone',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteMessage(id, userId ?? '');
                await reload();
              } catch (err) {
                setError((err as Error).message);
              }
            })();
          },
        },
        {
          text: 'Delete for me',
          onPress: () => {
            void (async () => {
              try {
                await hideMessageLocally(id);
                setHiddenIds((prev) => new Set(prev).add(id));
                setMessages((prev) => prev.filter((m) => m.id !== id));
              } catch (err) {
                setError((err as Error).message);
              }
            })();
          },
        },
      ],
    );
  };

  const handleReact = async (messageId: string, emoji: string) => {
    if (!userId || !keys || !conversationId) {
      return;
    }
    setActionId(null);
    try {
      await setReaction(peerUserId, userId, keys, messageId, conversationId, emoji);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const revealedIdRef = useRef<string | null>(null);
  revealedIdRef.current = revealedTimeId;

  const handleLongPress = useCallback((id: string) => {
    // Long-press = open the action bar for this bubble (reactions/edit/delete);
    // tapping a bubble with the bar open closes it. Timestamp reveal moved
    // into the action bar as a "Show time" toggle.
    setActionId((prev) => (prev === id ? null : id));
    setRevealedTimeId(null);
  }, []);

  // Mark the peer's messages as read while the chat is open.
  useEffect(() => {
    if (!userId || !conversationId) {
      return;
    }
    const peerMessageIds = messages
      .filter((m) => m.senderId !== userId)
      .map((m) => m.id);
    if (peerMessageIds.length === 0) {
      return;
    }
    void markMessagesRead(conversationId, userId, peerMessageIds);
  }, [userId, conversationId, messages]);

  // Purge expired disappearing messages: on boot + every 60s. Client-side
  // hide only — the server copy persists unless the sender deletes (PRD).
  useEffect(() => {
    const purge = () => {
      const now = Date.now();
      setMessages((prev) =>
        prev.filter((m) => {
          if (!m.disappearHours || m.disappearHours <= 0) {
            return true;
          }
          return now - new Date(m.sentAt).getTime() < m.disappearHours * 3600_000;
        }),
      );
    };
    purge();
    const timer = setInterval(purge, 60_000);
    return () => clearInterval(timer);
  }, []);

  // Owner smoke-test BUG 3: exactly ONE eye per thread, attached under MY
  // most recent message (right-aligned). No messages of mine → no eye.
  const lastMineId = useMemo(
    () => messages.findLast((m) => m.senderId === userId)?.id ?? null,
    [messages, userId],
  );

  const renderBubble = ({ index }: { index: number }) => {
    const item = messages[index];
    if (!item) {
      return null;
    }
    const mine = item.senderId === userId;
    // Grouping: consecutive bubbles from the same sender; only the LAST
    // bubble of a group carries the tail.
    const lastOfGroup = !messages[index + 1] || messages[index + 1].senderId !== item.senderId;
    const animate = !(initialIdsRef.current?.has(item.id) ?? false);
    // Aggregate reactions for THIS message: emoji → count.
    const rx = new Map<string, number>();
    for (const emoji of (reactions.get(item.id)?.values() ?? [])) {
      rx.set(emoji, (rx.get(emoji) ?? 0) + 1);
    }
    return (
      <View>
        <Bubble
          item={item}
          mine={mine}
          lastOfGroup={lastOfGroup}
          animate={animate}
          showTime={revealedIdRef.current === item.id}
          reactions={rx}
          showReceipt={item.id === lastMineId}
          readByPeerReadAt={readIds.get(item.id)}
          onLongPress={handleLongPress}
        />
        {actionId === item.id ? (
          <View style={styles.actionBar}>
            {REACTION_EMOJIS.map((emoji) => (
              <Pressable
                key={emoji}
                accessibilityLabel={`React ${emoji}`}
                onPress={() => void handleReact(item.id, emoji)}
                style={styles.actionEmoji}
              >
                <Text style={styles.actionEmojiText}>{emoji}</Text>
              </Pressable>
            ))}
            {mine && !item.undecryptable && isEditable(item.sentAt) ? (
              <Pressable
                accessibilityLabel="Edit message"
                onPress={() => {
                  setEditingId(item.id);
                  setDraft(item.body);
                  setActionId(null);
                }}
                style={styles.actionTextBtn}
              >
                {/* ITEM 5: remaining 15-minute window shown inline. */}
                <Text style={styles.actionTextBtnText}>
                  {`Edit (${Math.max(
                    1,
                    Math.round(
                      (15 * 60_000 - (Date.now() - new Date(item.sentAt).getTime())) /
                        60_000,
                    ),
                  )}m)`}
                </Text>
              </Pressable>
            ) : null}
            {mine && !item.undecryptable ? (
              <Pressable
                accessibilityLabel="Delete message"
                onPress={() => confirmDelete(item.id)}
                style={styles.actionTextBtn}
              >
                <Text style={styles.actionTextDanger}>Delete</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel="Show timestamp"
              onPress={() => {
                setRevealedTimeId((prev) => (prev === item.id ? null : item.id));
                setActionId(null);
              }}
              style={styles.actionTextBtn}
            >
              <Text style={styles.actionTextBtnText}>Time</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  };

  const DISAPPEAR_OPTIONS: Array<{ label: string; hours: number | null }> = [
    { label: 'Off', hours: null },
    { label: '24 hours', hours: 24 },
    { label: '7 days', hours: 24 * 7 },
  ];
  if (__DEV__) {
    DISAPPEAR_OPTIONS.push({ label: '60 seconds (test)', hours: 1 / 60 });
  }

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
        <Pressable
          accessibilityLabel="Disappearing messages setting"
          onPress={() => setShowDisappearMenu((v) => !v)}
          style={styles.disappearButton}
        >
          <Ionicons
            name={disappearHours ? 'hourglass' : 'hourglass-outline'}
            size={18}
            color={disappearHours ? colors.accent : colors.textSecondary}
          />
        </Pressable>
      </View>
      {showDisappearMenu ? (
        <View style={styles.disappearMenu}>
          {DISAPPEAR_OPTIONS.map((opt) => (
            <Pressable
              key={opt.label}
              accessibilityLabel={`Disappear: ${opt.label}`}
              onPress={() => {
                setDisappearHours(opt.hours);
                setShowDisappearMenu(false);
              }}
              style={styles.disappearOption}
            >
              <Text
                style={[
                  styles.disappearOptionText,
                  disappearHours === opt.hours && styles.disappearOptionActive,
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {peerTyping ? (
        <View style={styles.typingRow} pointerEvents="none">
          <TypingDots />
        </View>
      ) : null}

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
          // Re-render visible rows when receipts change or the Seen-label
          // tick fires (ITEM 3 live rollover).
          extraData={`${readIds.size}:${seenTick}`}
          keyExtractor={(m) => m.id}
          // ITEM 7 memoization: Bubble rows are React.memo'd and onLongPress
          // is a stable useCallback, so receipt/typing/reaction reloads
          // don't re-render every bubble.
          renderItem={renderBubble}
          contentContainerStyle={styles.listContent}
          // ITEM 7: open/new-message scrolling is ANIMATED, never a teleport.
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
          removeClippedSubviews
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={11}
        />
      )}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={[styles.composer, { paddingBottom: insets.bottom + spacing.sm }]}>
        {editingId ? (
          <View style={styles.editBanner}>
            <Text style={styles.editBannerText}>Editing message</Text>
            <Pressable accessibilityLabel="Cancel edit" onPress={() => { setEditingId(null); setDraft(''); }}>
              <Text style={styles.editBannerCancel}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={handleDraftChange}
          placeholder={editingId ? 'New text…' : 'Message'}
          placeholderTextColor={colors.textSecondary}
          multiline
          editable={!sending}
        />
        <Pressable
          accessibilityLabel={editingId ? 'Save edit' : 'Send message'}
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
            <Text style={styles.sendText}>{editingId ? 'Save' : 'Send'}</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/** Three bouncing dots above the composer while the PEER types. */
function TypingDots() {
  const t1 = useSharedValue(0);
  const t2 = useSharedValue(0);
  const t3 = useSharedValue(0);
  useEffect(() => {
    const loop = (sv: { value: number }) => {
      sv.value = 0;
      sv.value = withRepeat(
        withSequence(withTiming(1, { duration: 300 }), withTiming(0, { duration: 300 })),
        -1,
        false,
      );
    };
    loop(t1);
    loop(t2);
    loop(t3);
  }, [t1, t2, t3]);
  const s1 = useAnimatedStyle(() => ({ transform: [{ translateY: -4 * t1.value }], opacity: 0.4 + 0.6 * t1.value }));
  const s2 = useAnimatedStyle(() => ({ transform: [{ translateY: -4 * t2.value }], opacity: 0.4 + 0.6 * t2.value }));
  const s3 = useAnimatedStyle(() => ({ transform: [{ translateY: -4 * t3.value }], opacity: 0.4 + 0.6 * t3.value }));
  return (
    <View style={styles.typingDots}>
      <Animated.View style={[styles.typingDot, s1]} />
      <Animated.View style={[styles.typingDot, s2]} />
      <Animated.View style={[styles.typingDot, s3]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  typingRow: {
    position: 'absolute',
    left: spacing.md,
    bottom: 80,
    zIndex: 10,
  },
  typingDots: {
    flexDirection: 'row',
    gap: 5,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.textSecondary,
  },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 2,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginHorizontal: spacing.md,
    marginTop: 2,
    marginBottom: 4,
  },
  actionEmoji: {
    padding: 6,
  },
  actionEmojiText: {
    fontSize: 20,
  },
  actionTextBtn: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  actionTextBtnText: {
    fontSize: 13,
    fontFamily: fontFamily.semiBold,
    color: colors.text,
  },
  actionTextDanger: {
    fontSize: 13,
    fontFamily: fontFamily.semiBold,
    color: '#B84A4A',
  },
  disappearButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disappearMenu: {
    position: 'absolute',
    right: spacing.md,
    top: 100,
    zIndex: 20,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 4,
    minWidth: 160,
  },
  disappearOption: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  disappearOptionText: {
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: colors.text,
  },
  disappearOptionActive: {
    color: colors.accent,
    fontFamily: fontFamily.semiBold,
  },
  editBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 4,
  },
  editBannerText: {
    fontSize: 12,
    fontFamily: fontFamily.medium,
    color: colors.accent,
  },
  editBannerCancel: {
    fontSize: 12,
    fontFamily: fontFamily.semiBold,
    color: colors.textSecondary,
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

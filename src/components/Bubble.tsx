import React, { memo, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';

import type { ChatMessage } from '../lib/messages';
import { colors, fontFamily, spacing } from '../theme/theme';

/**
 * One chat bubble (Phase 5, Part C).
 *
 * Layout state is computed by the caller (grouping / tail / side).
 * The timestamp is HIDDEN by default and appears only while
 * `showTime` is true (11sp/500, textSecondary) per the spec.
 *
 * Entrance animation (Reanimated worklets on the UI thread — 60fps):
 * fade-in + slide-up mixed with a springy pop. Only messages that
 * arrive AFTER mount animate; the historical thread renders static
 * so opening a chat never plays a parade of stale animations.
 */

const SPRING_CONFIG = { damping: 14, stiffness: 180, mass: 0.65 };

export interface BubbleProps {
  item: ChatMessage;
  mine: boolean;
  /** True when this is the LAST bubble of a consecutive-sender group — gets the tail. */
  lastOfGroup: boolean;
  /** False for messages already in the thread at mount (no entrance animation). */
  animate: boolean;
  showTime: boolean;
  /** Aggregated reaction chips for this message: emoji → count. */
  reactions: Map<string, number>;
  /** Phase 6 Part C: on MY messages — outline eye = sent, filled accent eye = read. */
  readByPeer: boolean;
  onLongPress: (id: string) => void;
}

function BubbleImpl({ item, mine, lastOfGroup, animate, showTime, reactions, readByPeer, onLongPress }: BubbleProps) {
  const t = useSharedValue(animate ? 0 : 1);

  useEffect(() => {
    if (animate) {
      t.value = withDelay(60, withSpring(1, SPRING_CONFIG));
    }
    // Run once per mount — the pop should play exactly once. `animate` and
    // `t` are stable for a given mounted bubble (memoized by id below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entrance = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [
      { translateY: 16 * (1 - t.value) },
      { scale: 0.8 + 0.2 * t.value },
    ],
  }));

  return (
    <Pressable
      accessibilityLabel={
        item.undecryptable ? 'Encrypted message' : `Message from ${mine ? 'me' : 'them'}: ${item.body}`
      }
      onLongPress={() => onLongPress(item.id)}
      delayLongPress={250}
      style={({ pressed }) => [styles.row, mine ? styles.rowMine : null, pressed && styles.rowPressed]}
    >
      <View style={[styles.bubbleColumn, mine ? styles.columnEnd : null]}>
        <Animated.View
          style={[
            styles.bubble,
            mine ? styles.bubbleMine : styles.bubbleTheirs,
            lastOfGroup && (mine ? styles.tailMine : styles.tailTheirs),
            entrance,
          ]}
        >
          <Text style={styles.bubbleText}>
            {item.undecryptable ? '🔒 Encrypted message' : item.body}
            {item.editedAt && !item.undecryptable ? ' (edited)' : null}
          </Text>
          {showTime ? (
            <Text style={styles.bubbleTime}>
              {new Date(item.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          ) : null}
        </Animated.View>
        {reactions.size > 0 ? (
          <View style={[styles.chipRow, mine ? styles.columnEnd : null]}>
            {[...reactions.entries()].map(([emoji, count]) => (
              <View key={emoji} style={styles.chip}>
                <Text style={styles.chipEmoji}>{emoji}</Text>
                {count > 1 ? <Text style={styles.chipCount}>{count}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}
        {mine && !item.undecryptable ? (
          <View style={[styles.receiptRow, lastOfGroup ? null : styles.receiptHidden]}>
            <Ionicons
              name={readByPeer ? 'eye' : 'eye-outline'}
              size={13}
              color={readByPeer ? colors.accent : colors.textSecondary}
            />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * Memoized: FlatList re-renders skip unchanged bubbles; the props the
 * parent passes (mine/lastOfGroup/animate/showTime) fully determine the
 * render, so a shallow prop check is safe here.
 */
export const Bubble = memo(BubbleImpl);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.md,
    marginBottom: 2,
  },
  rowMine: {
    justifyContent: 'flex-end',
  },
  rowPressed: {
    opacity: 0.8,
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleMine: {
    backgroundColor: colors.accent,
    borderBottomRightRadius: 16,
    borderBottomLeftRadius: 16,
  },
  bubbleTheirs: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  tailMine: {
    borderBottomRightRadius: 4,
  },
  tailTheirs: {
    borderBottomLeftRadius: 4,
  },
  bubbleColumn: {
    maxWidth: '80%',
    gap: 2,
  },
  columnEnd: {
    alignItems: 'flex-end',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  chipEmoji: {
    fontSize: 12,
  },
  chipCount: {
    fontSize: 10,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
  },
  receiptRow: {
    paddingHorizontal: 2,
  },
  receiptHidden: {
    opacity: 0.6,
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
});

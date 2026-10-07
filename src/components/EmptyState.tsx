import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, spacing } from '../theme/theme';

/**
 * Part C empty state: generic silhouette + "No messages yet. Say Hi!"
 * Used on the Chats list now; reused inside conversations in Phase 5.
 */
export function EmptyState() {
  return (
    <View style={styles.container}>
      <View style={styles.avatar}>
        <View style={styles.head} />
        <View style={styles.torso} />
      </View>
      <Text style={styles.message}>No messages yet. Say Hi!</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.silhouette,
    overflow: 'hidden',
    alignItems: 'center',
  },
  head: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.textSecondary,
    opacity: 0.55,
    marginTop: 22,
  },
  torso: {
    width: 58,
    height: 42,
    borderTopLeftRadius: 29,
    borderTopRightRadius: 29,
    backgroundColor: colors.textSecondary,
    opacity: 0.55,
    marginTop: 4,
  },
  message: {
    fontSize: 15,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

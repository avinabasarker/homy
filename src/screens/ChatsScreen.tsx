import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '../components/EmptyState';
import { colors, fontFamily, spacing } from '../theme/theme';

/** Phase 1 placeholder — the real conversation list arrives in Phase 5. */
export function ChatsScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.headerTitle}>Chats</Text>
      </View>
      <EmptyState />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: fontFamily.semiBold,
    color: colors.text,
  },
});

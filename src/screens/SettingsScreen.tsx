import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontFamily, spacing } from '../theme/theme';

/** Phase 1 placeholder — auth and account settings arrive in Phase 2. */
export function SettingsScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>
      <View style={styles.card}>
        <View style={styles.avatar}>
          <View style={styles.head} />
          <View style={styles.torso} />
        </View>
        <Text style={styles.cardTitle}>You are signed out</Text>
        <Text style={styles.cardBody}>
          Account and security settings will appear here after you register or
          sign in.
        </Text>
      </View>
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    margin: spacing.md,
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.silhouette,
    overflow: 'hidden',
    alignItems: 'center',
  },
  head: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.textSecondary,
    opacity: 0.55,
    marginTop: 15,
  },
  torso: {
    width: 38,
    height: 28,
    borderTopLeftRadius: 19,
    borderTopRightRadius: 19,
    backgroundColor: colors.textSecondary,
    opacity: 0.55,
    marginTop: 3,
  },
  cardTitle: {
    fontSize: 16,
    fontFamily: fontFamily.semiBold,
    color: colors.text,
  },
  cardBody: {
    fontSize: 13,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

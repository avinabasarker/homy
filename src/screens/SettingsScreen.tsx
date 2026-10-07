import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '../components/PrimaryButton';
import { useAuth } from '../state/AuthProvider';
import { colors, fontFamily, spacing } from '../theme/theme';

export function SettingsScreen() {
  const { username, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

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
        <Text style={styles.cardTitle}>{username ? `@${username}` : 'Signed in'}</Text>
        <Text style={styles.cardBody}>
          End-to-end encrypted. Your keys are stored on this device only.
        </Text>
      </View>

      <View style={styles.section}>
        <PrimaryButton label="Log out" variant="ghost" onPress={handleLogout} loading={loggingOut} />
        <Text style={styles.version}>Homy v2.1 · Phase 2</Text>
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
  section: {
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  version: {
    fontSize: 11,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

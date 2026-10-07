import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '../components/PrimaryButton';
import { getRecoveryPhrase } from '../lib/auth';
import { useAuth } from '../state/AuthProvider';
import { colors, fontFamily, spacing } from '../theme/theme';

/**
 * Recovery phrase — shown ONCE per device until "I have saved it".
 * Read from SecureStore; never logged, never sent anywhere (Part A rule 9).
 */
export function RecoveryPhraseScreen() {
  const { userId, confirmRecoverySaved } = useAuth();
  const insets = useSafeAreaInsets();

  const [words, setWords] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!userId) {
      return;
    }
    getRecoveryPhrase(userId)
      .then((phrase) => setWords(phrase.split(' ')))
      .catch((loadError) => setError((loadError as Error).message));
  }, [userId]);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await confirmRecoverySaved();
    } finally {
      setConfirming(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[
        styles.container,
        {
          paddingTop: insets.top + spacing.xl,
          paddingBottom: insets.bottom + spacing.lg,
        },
      ]}
    >
      <Text style={styles.title}>Your recovery phrase</Text>
      <Text style={styles.warning}>
        Write these 12 words on paper, in this exact order. They are the ONLY
        way to restore your message history on a new device. Never share them
        with anyone.
      </Text>

      <View style={styles.grid}>
        {words.map((word, index) => (
          <View key={`${word}-${index}`} style={styles.wordBox}>
            <Text style={styles.wordIndex}>{index + 1}</Text>
            <Text style={styles.word}>{word}</Text>
          </View>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.checkRow} onPress={() => setSaved((value) => !value)}>
        <View style={[styles.checkbox, saved ? styles.checkboxOn : null]}>
          {saved ? <Text style={styles.checkmark}>✓</Text> : null}
        </View>
        <Text style={styles.checkLabel}>I wrote these 12 words on paper</Text>
      </Pressable>

      <PrimaryButton
        label="I have saved it"
        onPress={handleConfirm}
        disabled={!saved}
        loading={confirming}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  title: {
    fontSize: 20,
    fontFamily: fontFamily.semiBold,
    color: colors.text,
  },
  warning: {
    fontSize: 13,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  wordBox: {
    width: '31%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  wordIndex: {
    fontSize: 11,
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
  },
  word: {
    fontSize: 15,
    fontFamily: fontFamily.regular,
    color: colors.text,
    flex: 1,
  },
  error: {
    fontSize: 13,
    fontFamily: fontFamily.regular,
    color: '#B84A4A',
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkmark: {
    fontSize: 14,
    fontFamily: fontFamily.semiBold,
    color: '#FFFFFF',
  },
  checkLabel: {
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: colors.text,
  },
});

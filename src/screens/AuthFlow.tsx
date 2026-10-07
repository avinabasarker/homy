import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '../components/PrimaryButton';
import { colors, fontFamily, spacing } from '../theme/theme';
import { LoginScreen } from './LoginScreen';
import { RegisterScreen } from './RegisterScreen';

type AuthMode = 'welcome' | 'register' | 'login';

export function AuthFlow() {
  const [mode, setMode] = useState<AuthMode>('welcome');
  const insets = useSafeAreaInsets();

  if (mode === 'register') {
    return <RegisterScreen onBack={() => setMode('welcome')} />;
  }
  if (mode === 'login') {
    return <LoginScreen onBack={() => setMode('welcome')} />;
  }

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top + spacing.xl,
          paddingBottom: insets.bottom + spacing.lg,
        },
      ]}
    >
      <View style={styles.logoCircle}>
        <Text style={styles.logoText}>H</Text>
      </View>
      <Text style={styles.title}>Homy</Text>
      <Text style={styles.subtitle}>
        Private, end-to-end encrypted messages for your circle. The server only
        ever sees ciphertext.
      </Text>
      <View style={styles.actions}>
        <PrimaryButton label="Create account" onPress={() => setMode('register')} />
        <PrimaryButton
          label="I have an account"
          variant="ghost"
          onPress={() => setMode('login')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    gap: spacing.sm,
  },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  logoText: {
    fontSize: 32,
    fontFamily: fontFamily.semiBold,
    color: '#FFFFFF',
  },
  title: {
    fontSize: 24,
    fontFamily: fontFamily.semiBold,
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  actions: {
    gap: spacing.sm,
  },
});

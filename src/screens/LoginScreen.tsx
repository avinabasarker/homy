import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '../components/PrimaryButton';
import { TextField } from '../components/TextField';
import { useAuth } from '../state/AuthProvider';
import { colors, fontFamily, spacing } from '../theme/theme';

export function LoginScreen({ onBack }: { onBack: () => void }) {
  const { login } = useAuth();
  const insets = useSafeAreaInsets();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      await login({ username, password });
      // On success AuthProvider routes to PIN setup/unlock or the recovery gate.
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'android' ? undefined : 'padding'}
    >
      <View
        style={[
          styles.container,
          {
            paddingTop: insets.top + spacing.xl,
            paddingBottom: insets.bottom + spacing.lg,
          },
        ]}
      >
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.hint}>Sign in with your username and password.</Text>

        <View style={styles.form}>
          <TextField
            label="Username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            placeholder="your_username"
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.actions}>
          <PrimaryButton label="Sign in" onPress={handleSubmit} loading={loading} />
          <PrimaryButton label="Back" variant="ghost" onPress={onBack} disabled={loading} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    gap: spacing.md,
  },
  title: {
    fontSize: 20,
    fontFamily: fontFamily.semiBold,
    color: colors.text,
  },
  hint: {
    fontSize: 13,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
  },
  form: {
    gap: spacing.sm,
  },
  error: {
    fontSize: 13,
    fontFamily: fontFamily.regular,
    color: '#B84A4A',
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});

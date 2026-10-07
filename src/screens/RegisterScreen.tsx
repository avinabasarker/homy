import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '../components/PrimaryButton';
import { TextField } from '../components/TextField';
import { useAuth } from '../state/AuthProvider';
import { colors, fontFamily, spacing } from '../theme/theme';

export function RegisterScreen({ onBack }: { onBack: () => void }) {
  const { register } = useAuth();
  const insets = useSafeAreaInsets();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    if (pin !== pinConfirm) {
      setError('The two PINs do not match.');
      return;
    }
    setLoading(true);
    try {
      await register({ username, password, pin });
      // On success AuthProvider switches to the recovery-phrase gate.
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
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.container,
          {
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.lg,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.hint}>
          Just a username and password — no phone number, no real email.
        </Text>

        <View style={styles.form}>
          <TextField
            label="Username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="lowercase_3_to_20"
          />
          <TextField
            label="Password (min 6 characters)"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <TextField
            label="PIN (4–8 digits) — unlocks this app"
            value={pin}
            onChangeText={(value) => setPin(value.replace(/[^0-9]/g, ''))}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={8}
          />
          <TextField
            label="Confirm PIN"
            value={pinConfirm}
            onChangeText={(value) => setPinConfirm(value.replace(/[^0-9]/g, ''))}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={8}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.actions}>
          <PrimaryButton label="Create account" onPress={handleSubmit} loading={loading} />
          <PrimaryButton label="Back" variant="ghost" onPress={onBack} disabled={loading} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
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

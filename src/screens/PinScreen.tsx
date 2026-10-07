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

export function PinScreen({ mode }: { mode: 'setup' | 'unlock' }) {
  const { submitPin, username } = useAuth();
  const insets = useSafeAreaInsets();

  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      await submitPin(pin);
    } catch (pinError) {
      setError((pinError as Error).message);
      setPin('');
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
        <Text style={styles.title}>
          {mode === 'setup' ? 'Create your PIN' : 'Homy is locked'}
        </Text>
        <Text style={styles.hint}>
          {mode === 'setup'
            ? '4–8 digits. This PIN unlocks Homy on THIS device only.'
            : `Enter your PIN to unlock Homy${username ? `, ${username}` : ''}.`}
        </Text>

        <View style={styles.form}>
          <TextField
            label={mode === 'setup' ? 'New PIN (4–8 digits)' : 'Your PIN'}
            value={pin}
            onChangeText={(value) => setPin(value.replace(/[^0-9]/g, ''))}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={8}
            autoFocus
            onSubmitEditing={handleSubmit}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <PrimaryButton
          label={mode === 'setup' ? 'Save PIN' : 'Unlock'}
          onPress={handleSubmit}
          loading={loading}
          disabled={pin.length < 4}
        />
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
});

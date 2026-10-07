import './polyfills';

import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts,
} from '@expo-google-fonts/inter';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';

import { SecurityScrim } from './src/components/SecurityScrim';
import { RootTabs } from './src/navigation/RootTabs';
import { AuthFlow } from './src/screens/AuthFlow';
import { PinScreen } from './src/screens/PinScreen';
import { RecoveryPhraseScreen } from './src/screens/RecoveryPhraseScreen';
import { AuthProvider, useAuth } from './src/state/AuthProvider';
import { colors } from './src/theme/theme';

const navigationTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.accent,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    border: colors.border,
    notification: colors.accent,
  },
};

function AppBody() {
  const { status } = useAuth();

  if (status === 'initializing') {
    return <View style={styles.container} />;
  }
  if (status === 'signedOut') {
    return <AuthFlow />;
  }
  if (status === 'recoveryGate') {
    return <RecoveryPhraseScreen />;
  }
  if (status === 'pinSetup') {
    return <PinScreen mode="setup" />;
  }
  if (status === 'locked') {
    return <PinScreen mode="unlock" />;
  }
  return (
    <NavigationContainer theme={navigationTheme}>
      <RootTabs />
    </NavigationContainer>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <AuthProvider>
      <View style={styles.container}>
        <StatusBar style="light" />
        <AppBody />
        {appState !== 'active' && <SecurityScrim />}
      </View>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
});

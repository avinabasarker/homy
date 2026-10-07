import './polyfills';

import React, { useEffect, useState } from 'react';
import { AppState } from 'react-native';
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
    <NavigationContainer theme={navigationTheme}>
      <StatusBar style="light" />
      <RootTabs />
      {appState !== 'active' && <SecurityScrim />}
    </NavigationContainer>
  );
}

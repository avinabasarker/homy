import React from 'react';
import { StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';

import { colors } from '../theme/theme';

/**
 * Part C security UI: heavy blur + dark scrim whenever the app leaves the
 * foreground, so the Android Recents snapshot reveals nothing.
 * Rendered above the whole app; blocks all touches while visible.
 */
export function SecurityScrim() {
  return (
    <View style={StyleSheet.absoluteFill}>
      <BlurView
        intensity={100}
        tint="dark"
        blurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, styles.dim]} />
    </View>
  );
}

const styles = StyleSheet.create({
  dim: {
    backgroundColor: 'rgba(18, 18, 18, 0.55)',
  },
});

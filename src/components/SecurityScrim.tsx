import React, { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import type { View as RNView } from 'react-native';
import { BlurView, BlurTargetView } from 'expo-blur';

import { colors } from '../theme/theme';

/**
 * Part C security UI: heavy blur + dark scrim whenever the app leaves the
 * foreground, so the Android Recents snapshot reveals nothing.
 * Rendered above the whole app; blocks all touches while visible.
 *
 * SDK 57 Android API (per docs): the content is wrapped in BlurTargetView
 * and the BlurView points at it via blurTarget; without that the blur
 * silently falls back to 'none'.
 */
export function SecurityScrim() {
  const targetRef = useRef<RNView | null>(null);

  return (
    <BlurTargetView ref={targetRef} style={StyleSheet.absoluteFill}>
      <BlurView
        intensity={100}
        tint="dark"
        blurMethod="dimezisBlurView"
        blurTarget={targetRef}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, styles.dim]} />
    </BlurTargetView>
  );
}

const styles = StyleSheet.create({
  dim: {
    backgroundColor: 'rgba(18, 18, 18, 0.55)',
  },
});

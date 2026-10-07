import type { TextStyle } from 'react-native';

/**
 * Homy design system — Part C ("Pixel-Perfect").
 * Single source of truth for every color, font, and spacing value.
 * Never hardcode these values in components; import from here.
 */
export const colors = {
  background: '#121212', // App background
  surface: '#1E1E1E', // Bubbles / cards / tab bar
  accent: '#5E5CE6', // Primary accent
  text: '#FFFFFF', // Primary text
  textSecondary: '#A0A0B0', // Secondary text
  // Supporting tones Part C does not specify — flagged in PROGRESS.md:
  border: '#2A2A2A', // Hairlines (tab bar top edge)
  silhouette: '#3A3A44', // Empty-state / avatar silhouette fill
} as const;

export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
} as const;

/** Part C typography (Android sp maps 1:1 to RN dp). */
export const typography = {
  chatTitle: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: fontFamily.semiBold,
    color: colors.text,
  } satisfies TextStyle,
  messageText: {
    fontSize: 15,
    fontWeight: '400',
    fontFamily: fontFamily.regular,
    color: colors.text,
  } satisfies TextStyle,
  timestamp: {
    fontSize: 11,
    fontWeight: '500',
    fontFamily: fontFamily.medium,
    color: colors.textSecondary,
  } satisfies TextStyle,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

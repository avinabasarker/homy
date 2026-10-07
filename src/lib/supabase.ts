// supabase.ts — the ONE Supabase client for the whole app (Part H #6).
// Hermes needs the polyfills BEFORE supabase-js loads (Part H #1).
import '../../polyfills';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.includes('YOUR_')) {
    throw new Error(
      `${name} is missing or still a placeholder in homy/.env — ` +
        'paste the real value from Supabase Dashboard → Project Settings → API.',
    );
  }
  return value;
}

export const supabase = createClient(
  requireEnv('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
  requireEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  {
    auth: {
      storage: AsyncStorage, // Part H #6 — session survives restarts
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

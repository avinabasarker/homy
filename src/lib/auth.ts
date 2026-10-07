// auth.ts — Homy account lifecycle (Part D1 + Part H).
// - Hidden internal email <username>@users.homy.app; the user never sees it.
// - Registration order per Part H #13: generate keys/phrase → signUp →
//   SecureStore + DB writes (the fresh signUp session satisfies RLS).
// - No password, PIN, key, or phrase is ever logged (Part A rule 9).
import '../../polyfills';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

import { ensureDeviceKeys } from './keys';
import { clearPinSecret, isPinFormatValid, setPinSecret } from './pin';
import { secureGet, secureKeys, secureSet } from './secureStore';
import { supabase } from './supabase';

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

const RECOVERY_ENTROPY_BITS = 128; // → 12 words (Part D1)
const HEARTBEAT_MS = 45_000; // Part H #10

export function internalEmail(username: string): string {
  return `${username.toLowerCase()}@users.homy.app`;
}

export function validateUsername(
  raw: string,
): { ok: true; username: string } | { ok: false; error: string } {
  const username = raw.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    return {
      ok: false,
      error: 'Usernames are 3–20 characters: a-z, 0-9, underscore.',
    };
  }
  return { ok: true, username };
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('username_available', {
    p_username: username,
  });
  if (error) {
    throw new Error(`Could not check that username: ${error.message}`);
  }
  return data === true;
}

export interface RegisterInput {
  username: string;
  password: string;
  pin: string;
}

export interface RegisterResult {
  userId: string;
  username: string;
  mnemonic: string;
}

export async function registerAccount(input: RegisterInput): Promise<RegisterResult> {
  const check = validateUsername(input.username);
  if (!check.ok) {
    throw new Error(check.error);
  }
  const username = check.username;

  if (input.password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }
  if (!isPinFormatValid(input.pin)) {
    throw new Error('PIN must be 4 to 8 digits.');
  }
  if (!(await isUsernameAvailable(username))) {
    throw new Error('That username is taken.');
  }

  // 1) Generate crypto material BEFORE signUp (Part H #13).
  const mnemonic = generateMnemonic(wordlist, RECOVERY_ENTROPY_BITS);

  // 2) Sign up with the hidden internal email. The DB trigger
  //    on_auth_user_created builds the profile from metadata.username
  //    (Part H #3 — options.data.username is MANDATORY).
  const { data, error } = await supabase.auth.signUp({
    email: internalEmail(username),
    password: input.password,
    options: { data: { username } },
  });
  if (error) {
    throw new Error(friendlyAuthError(error.message));
  }
  if (!data.session || !data.user) {
    // Part H #4 — "Confirm email" got re-enabled in the dashboard.
    throw new Error(
      'Sign-up succeeded but no session was returned. Open the Supabase dashboard → ' +
        'Authentication → Sign In / Providers and turn "Confirm email" OFF, then try again.',
    );
  }

  const userId = data.user.id;

  // 3) Persist secrets on-device and public halves in the DB (RLS-active session).
  try {
    await Promise.all([
      secureSet(secureKeys.recoveryPhrase(userId), mnemonic),
      setPinSecret(userId, input.pin),
    ]);
    await ensureDeviceKeys(userId);
    await upsertPresence(userId, true);
  } catch (setupError) {
    // The auth account exists but device setup failed — tell the beginner exactly what to do.
    throw new Error(
      `Account created, but setup did not finish: ${(setupError as Error).message} ` +
        'Delete this test user in Supabase → Authentication → Users, then register again.',
    );
  }

  await markRecoveryPending(userId);
  return { userId, username, mnemonic };
}

export interface LoginResult {
  userId: string;
  username: string;
}

export async function loginAccount(input: {
  username: string;
  password: string;
}): Promise<LoginResult> {
  const check = validateUsername(input.username);
  if (!check.ok) {
    throw new Error(check.error);
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: internalEmail(check.username),
    password: input.password,
  });
  if (error) {
    throw new Error(friendlyAuthError(error.message));
  }
  if (!data.user) {
    throw new Error('Sign-in failed. Please try again.');
  }

  const userId = data.user.id;
  try {
    await ensureDeviceKeys(userId);
    await upsertPresence(userId, true);
  } catch (setupError) {
    throw new Error(`Signed in, but setup did not finish: ${(setupError as Error).message}`);
  }
  return { userId, username: check.username };
}

/** AsyncStorage session from a previous run → this device already knows the user. */
export async function restoreSession(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function signOutAccount(userId: string): Promise<void> {
  await upsertPresence(userId, false).catch(() => undefined); // best-effort (Part H #10)
  stopPresenceHeartbeat();
  await supabase.auth.signOut();
  await clearPinSecret(userId);
  await clearRecoveryPending(userId);
}

export async function getUsername(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', userId)
    .single();
  if (error || !data) {
    throw new Error('Could not load your profile.');
  }
  return data.username as string;
}

export async function getRecoveryPhrase(userId: string): Promise<string> {
  const phrase = await secureGet(secureKeys.recoveryPhrase(userId));
  if (!phrase) {
    throw new Error('Recovery phrase missing on this device.');
  }
  return phrase;
}

// ---- Presence heartbeat (Part H #10) ----

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

async function upsertPresence(userId: string, online: boolean): Promise<void> {
  const { error } = await supabase.from('presence').upsert({
    user_id: userId,
    online,
    last_seen: new Date().toISOString(),
  });
  if (error) {
    throw new Error(`Presence update failed: ${error.message}`);
  }
}

export function startPresenceHeartbeat(userId: string): void {
  stopPresenceHeartbeat();
  void upsertPresence(userId, true).catch(() => undefined); // immediate beat
  heartbeatTimer = setInterval(() => {
    void upsertPresence(userId, true).catch(() => undefined);
  }, HEARTBEAT_MS);
}

export function stopPresenceHeartbeat(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ---- Recovery-phrase gate flag (AsyncStorage — a flag, not a secret) ----

export async function markRecoveryPending(userId: string): Promise<void> {
  await AsyncStorage.setItem(`homy_must_show_recovery_${userId}`, '1');
}

export async function isRecoveryPending(userId: string): Promise<boolean> {
  return (await AsyncStorage.getItem(`homy_must_show_recovery_${userId}`)) === '1';
}

export async function clearRecoveryPending(userId: string): Promise<void> {
  await AsyncStorage.removeItem(`homy_must_show_recovery_${userId}`);
}

function friendlyAuthError(message: string): string {
  if (message.includes('User already registered')) {
    return 'That username is taken.'; // Part H #5
  }
  if (message.includes('Invalid login credentials')) {
    return 'Wrong username or password.'; // Part H #5
  }
  if (message.includes('Password should be at least')) {
    return 'Password must be at least 6 characters.';
  }
  if (message.includes('Failed to fetch') || message.includes('Network request failed')) {
    return 'You are offline, or the Supabase project is paused. Check your connection ' +
      '(and the Restore button in the Supabase dashboard).';
  }
  return message;
}

// secureStore.ts — device-only secrets. Key naming per Part H #2:
// keys must match /^[A-Za-z0-9.\-_]+$/ (colons throw "Invalid key provided").
// All Homy keys use underscores; userId is a UUID (hyphens are allowed).
import * as SecureStore from 'expo-secure-store';

export const secureKeys = {
  identitySecretKey: (userId: string) => `homy_id_sk_${userId}`,
  identityPublicKey: (userId: string) => `homy_id_pk_${userId}`,
  prekeySecretKey: (userId: string) => `homy_prekey_sk_${userId}`,
  recoveryPhrase: (userId: string) => `homy_recovery_${userId}`,
  pin: (userId: string) => `homy_pin_${userId}`,
} as const;

export async function secureGet(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function secureSet(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function secureDelete(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}

export async function secureHasKey(key: string): Promise<boolean> {
  return (await SecureStore.getItemAsync(key)) !== null;
}

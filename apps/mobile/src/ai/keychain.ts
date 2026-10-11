import * as SecureStore from 'expo-secure-store';

import type { ChatGptVault } from '@fizz/providers';

/**
 * The Keychain items GymSmarter owns (expo-secure-store; Keychain,
 * WHEN_UNLOCKED_THIS_DEVICE_ONLY, its own keychain service). Never SQLite or
 * files, so never in a backup (CLAUDE.md rule 7). Every SecureStore key the
 * app writes is declared here and listed in `KEYCHAIN_KEYS`; a test fails if
 * one isn't, so Delete my data can't miss it.
 */

const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: 'fizz.chatgpt',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const REGISTRATION_KEY = 'fizz.chatgpt.registration';
const TOKENS_KEY = 'fizz.chatgpt.tokens';

export const keychainVault: ChatGptVault = {
  loadRegistration: () => SecureStore.getItemAsync(REGISTRATION_KEY, KEYCHAIN_OPTIONS),
  saveRegistration: (s) => SecureStore.setItemAsync(REGISTRATION_KEY, s, KEYCHAIN_OPTIONS),
  loadTokens: () => SecureStore.getItemAsync(TOKENS_KEY, KEYCHAIN_OPTIONS),
  saveTokens: (s) => SecureStore.setItemAsync(TOKENS_KEY, s, KEYCHAIN_OPTIONS),
  deleteTokens: () => SecureStore.deleteItemAsync(TOKENS_KEY, KEYCHAIN_OPTIONS),
};

/**
 * Every Keychain item GymSmarter owns (Delete my data, §4.5 step 1). Items
 * survive an uninstall, so they are deleted by key, then checked gone.
 */
export const KEYCHAIN_KEYS: readonly string[] = [REGISTRATION_KEY, TOKENS_KEY];

/** Delete every item in `KEYCHAIN_KEYS`, then read each back. Throws if any is still there. */
export async function wipeKeychain(): Promise<void> {
  for (const key of KEYCHAIN_KEYS) await SecureStore.deleteItemAsync(key, KEYCHAIN_OPTIONS);
  const left: string[] = [];
  for (const key of KEYCHAIN_KEYS) {
    if ((await SecureStore.getItemAsync(key, KEYCHAIN_OPTIONS)) !== null) left.push(key);
  }
  if (left.length > 0) throw new Error(`${String(left.length)} coach sign-in item(s) are still in the Keychain`);
}

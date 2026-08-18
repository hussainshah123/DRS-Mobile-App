/**
 * Credential storage.
 *
 * The JWT is the only thing standing between a stolen phone and every managed
 * desktop in the fleet, so it goes in the platform keystore (iOS Keychain / Android
 * EncryptedSharedPreferences via the Keystore), never AsyncStorage — which is a
 * plaintext file readable by anything with filesystem access on a rooted device.
 *
 * `ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY` is deliberate on both counts: the
 * token is unreadable while the device is locked, and it is excluded from iCloud
 * Keychain sync and encrypted backups, so a session credential can never restore
 * onto a different device.
 *
 * The token and the cached user are stored as ONE JSON blob under a single service.
 * They are always written and cleared together; splitting them invites the state
 * where a token survives a partial sign-out.
 */
import * as Keychain from 'react-native-keychain';

import type { User } from '../types/user';
import { createLogger } from './logger';

const log = createLogger('storage');

const SERVICE = 'com.drs.session';
/** Keychain requires a username field; the blob lives in the password field. */
const ACCOUNT = 'drs';

export type StoredSession = {
  token: string;
  user: User;
};

const options: Keychain.SetOptions = {
  service: SERVICE,
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** saveSession persists the token + user atomically. Throws if the keystore rejects it. */
export async function saveSession(session: StoredSession): Promise<void> {
  await Keychain.setGenericPassword(ACCOUNT, JSON.stringify(session), options);
}

/**
 * loadSession returns the stored session, or null when there is none.
 *
 * A corrupt or schema-changed blob is treated as "no session" AND cleared, rather
 * than thrown: a parse failure on cold start would otherwise wedge the app at the
 * splash with no way out but a reinstall.
 */
export async function loadSession(): Promise<StoredSession | null> {
  try {
    const result = await Keychain.getGenericPassword({ service: SERVICE });
    if (!result) {
      return null;
    }
    const parsed = JSON.parse(result.password) as StoredSession;
    if (!parsed?.token || !parsed?.user?.id) {
      await clearSession();
      return null;
    }
    return parsed;
  } catch (err) {
    log.warn('could not read stored session; clearing', err);
    await clearSession();
    return null;
  }
}

/** clearSession removes the credential. Never throws — sign-out must always succeed. */
export async function clearSession(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: SERVICE });
  } catch (err) {
    log.warn('could not clear stored session', err);
  }
}

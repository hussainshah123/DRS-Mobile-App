/**
 * Authentication state.
 *
 * One session, one token, one place. The token lives in three places at once and the ordering
 * between them is what this file is really about:
 *
 *   1. the API client's in-memory copy — the source of truth for requests, so no async
 *      keystore read sits in the path of every call;
 *   2. the platform keystore — so a session survives an app restart;
 *   3. this context — so the UI can render from it.
 *
 * On sign-in all three are written before the UI is told; on sign-out all three are cleared
 * before the UI is told. Any other ordering produces the state where a screen renders as
 * signed-in while requests go out unauthenticated, or worse, the reverse.
 *
 * REVOCATION is handled centrally. The backend's RequireAuth re-checks live account state on
 * every request, so a token can be cryptographically valid and still rejected — blocked
 * account, deleted account, changed role, expiry. The API client reports those through
 * `onSessionRevoked`, and this context turns them into an immediate sign-out with a reason
 * the operator can read, rather than a confusing failure on whatever screen they happened to
 * be on.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { login as loginRequest, me as fetchMe } from '../api/auth';
import { ApiError, onSessionRevoked, setAuthToken, type RevocationCode } from '../api/client';
import type { User } from '../types/user';
import { createLogger, describeError } from '../utils/logger';
import { clearSession, loadSession, saveSession } from '../utils/storage';

const log = createLogger('auth');

/** Why the operator was signed out — shown on the login screen so it is not a mystery. */
const revocationCopy: Record<RevocationCode, string> = {
  account_blocked: 'Your account has been blocked. Contact your administrator.',
  account_deleted: 'Your account no longer exists.',
  role_changed: 'Your access level changed. Sign in again to continue.',
  token_invalid: 'Your session expired. Please sign in again.',
};

type AuthContextValue = {
  /** null once we know there is no session; undefined while still restoring. */
  user: User | null;
  token: string | null;
  /** True during the cold-start restore, so the app can hold a splash instead of flashing login. */
  restoring: boolean;
  /** True while a sign-in request is in flight. */
  signingIn: boolean;
  /** Last sign-in error, or the reason a session was revoked. */
  error: string;
  signIn: (identifier: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  clearError: () => void;
  /** Replaces the cached user after a profile update. */
  updateUser: (user: User) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState('');

  /** Clears all three copies. Used by sign-out and by revocation. */
  const teardown = useCallback(async () => {
    setAuthToken(null);
    setToken(null);
    setUser(null);
    await clearSession();
  }, []);

  // Cold start: restore, then VERIFY. A stored token that decodes fine can still be dead, and
  // `GET /api/auth/me` is the only way to find out — it is the same check the backend runs on
  // every request. Verifying here means the device list cannot render against a token that is
  // about to be rejected.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = await loadSession();
      if (cancelled) {
        return;
      }
      if (!stored) {
        setRestoring(false);
        return;
      }

      setAuthToken(stored.token);
      try {
        const fresh = await fetchMe();
        if (cancelled) {
          return;
        }
        setToken(stored.token);
        setUser(fresh);
        // Re-persist: the role or display name may have changed since the token was minted,
        // and a stale cached user would show the wrong operator name on the consent notice.
        await saveSession({ token: stored.token, user: fresh });
      } catch (err) {
        if (cancelled) {
          return;
        }
        // A network failure is NOT a revocation — the operator may simply be offline, and
        // signing them out would mean re-entering credentials to get back to a device list
        // they cannot reach anyway. Keep the session; the next request will re-check.
        if (err instanceof ApiError && err.isNetworkError) {
          log.warn('could not verify stored session (offline); keeping it');
          setToken(stored.token);
          setUser(stored.user);
        } else {
          log.info('stored session is no longer valid');
          await teardown();
          setError(describeError(err, 'Your session expired. Please sign in again.'));
        }
      } finally {
        if (!cancelled) {
          setRestoring(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [teardown]);

  // Central revocation handler. Registered once for the app's lifetime.
  useEffect(() => {
    onSessionRevoked(code => {
      log.info(`session revoked: ${code}`);
      void teardown();
      setError(revocationCopy[code] ?? 'Your session ended. Please sign in again.');
    });
    return () => onSessionRevoked(null);
  }, [teardown]);

  const signIn = useCallback(async (identifier: string, password: string): Promise<boolean> => {
    setSigningIn(true);
    setError('');
    try {
      const result = await loginRequest(identifier, password);
      // Order matters: the client must be able to authenticate before any screen renders as
      // signed in, or the first device fetch races the token.
      setAuthToken(result.token);
      await saveSession({ token: result.token, user: result.user });
      setToken(result.token);
      setUser(result.user);
      return true;
    } catch (err) {
      setError(describeError(err, 'Could not sign in.'));
      return false;
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await teardown();
    setError('');
  }, [teardown]);

  const updateUser = useCallback(
    (next: User) => {
      setUser(next);
      if (token) {
        void saveSession({ token, user: next });
      }
    },
    [token],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      restoring,
      signingIn,
      error,
      signIn,
      signOut,
      clearError: () => setError(''),
      updateUser,
    }),
    [user, token, restoring, signingIn, error, signIn, signOut, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}

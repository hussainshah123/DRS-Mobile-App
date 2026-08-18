/**
 * Auth endpoints. These are the EXISTING backend routes
 * (backend/internal/api/router.go) — no new auth surface is introduced.
 *
 * The two-step signup the dashboard offers is intentionally absent: onboarding a new
 * DRS operator involves an emailed code and a role assignment, which belongs on the
 * console, not on a field device. The app signs in existing operators only.
 */
import type { User } from '../types/user';
import { apiFetch } from './client';

type LoginResponse = {
  token: string;
  user: User;
};

/**
 * login exchanges credentials for a JWT.
 *
 * `identifier` may be either an email or a username — the backend accepts one field for
 * both (auth_handler.go's Login falls back to `email` for older clients; we send the
 * current `identifier` field).
 *
 * Throws ApiError: 401 on bad credentials (deliberately the same message whether the
 * account is missing or the password is wrong, so this cannot enumerate accounts), 403
 * when the account is blocked.
 */
export function login(identifier: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/api/auth/login', {
    method: 'POST',
    auth: false,
    body: { identifier: identifier.trim(), password },
  });
}

/**
 * me re-reads the signed-in operator.
 *
 * Called on cold start to confirm a stored token is still good. It is the cheapest way
 * to catch the cases a local expiry check cannot: the account was blocked or deleted, or
 * its role changed, since RequireAuth re-checks live account state on every request.
 */
export function me(): Promise<User> {
  return apiFetch<User>('/api/auth/me');
}

/** changePassword — the backend re-verifies the current password before storing a hash. */
export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return apiFetch<void>('/api/auth/password', {
    method: 'PUT',
    body: { current_password: currentPassword, new_password: newPassword },
  });
}

/**
 * updateProfile sets the display name. Worth having on mobile for one specific reason:
 * this name is what the backend stamps into `StartSession.Operator`, which is the text
 * the managed desktop shows on its consent notice ("<operator> is viewing this
 * device"). An operator with a blank profile shows up as a bare username on someone
 * else's screen.
 */
export async function updateProfile(fullName: string): Promise<User> {
  const data = await apiFetch<{ user: User }>('/api/auth/profile', {
    method: 'PUT',
    body: { full_name: fullName },
  });
  return data.user;
}

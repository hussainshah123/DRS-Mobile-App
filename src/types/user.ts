/**
 * The authenticated operator, exactly as `api.userView` serializes it
 * (backend/internal/api/auth_handler.go). Snake-case `full_name` is the wire name —
 * kept rather than camelized so a field can be traced from the Go struct to a screen
 * without a translation table.
 */
export type Role = 'user' | 'admin' | 'superadmin';

export type User = {
  id: string;
  username: string;
  full_name: string;
  email: string;
  role: Role;
  blocked: boolean;
};

/**
 * canOpenSession mirrors the gate in ws/session.go: ServeSession rejects any token
 * whose role is neither admin nor superadmin with a 403 BEFORE the WebSocket upgrade.
 *
 * This is a UI hint ONLY — it exists so a non-admin sees a disabled Connect button
 * with a reason instead of a socket that fails for no visible cause. The real
 * authorization is the backend's, and this must never be treated as the decision
 * (spec §13).
 */
export function canOpenSession(user: User | null): boolean {
  return user?.role === 'admin' || user?.role === 'superadmin';
}

/** displayName picks the friendliest identifier the token gave us. */
export function displayName(user: User | null): string {
  if (!user) {
    return '';
  }
  return user.full_name?.trim() || user.username || user.email;
}

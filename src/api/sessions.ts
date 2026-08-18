/**
 * Session endpoints — and, just as importantly, a record of what does NOT exist.
 *
 * THERE IS NO "START SESSION" REST CALL. The audit of the existing backend
 * (backend/internal/ws/session.go) shows that opening the WebSocket at
 * `/ws/session?deviceId=…` IS the start: ServeSession authenticates the token, checks
 * the device has a live agent, mints the session id itself with crypto/rand, sends
 * `start_session` to the agent with the ICE list and the operator name taken from the
 * JWT, and writes "Remote session started" to the audit log. Closing the socket is the
 * stop: its deferred cleanup sends `stop_session` and audits "Remote session ended".
 *
 * So the client must NOT invent `POST /api/sessions` (spec §17, §19: no undocumented
 * endpoint may be invented). The consequences the rest of the app is built around:
 *
 *   • The session id is DISCOVERED from the first inbound message that carries one —
 *     the client cannot know it in advance and must not generate one.
 *   • Session lifetime is exactly socket lifetime. There is no way to leave a session
 *     running in the background, and no separate stop call to make.
 *   • The mode requested is always `webrtc` (hard-coded server-side), and the agent
 *     downgrades itself to JPEG if it was built without the VP8 codec.
 *
 * The one REST call that does belong to a session is the ICE configuration.
 */
import type { ICEServerMessage } from '../protocol/messages';
import { apiFetch } from './client';
import { createLogger } from '../utils/logger';

const log = createLogger('api');

/**
 * fetchIceServers returns the STUN/TURN list for a session.
 *
 * The backend generates a FRESH list per call because the TURN credential is
 * time-limited (HMAC-SHA1 over an expiry timestamp, the coturn REST scheme), so this
 * must be called per session attempt and its result never cached across retries.
 *
 * Both peers must receive the identical list — the backend hands the same one to the
 * agent inside `start_session` — which is why this is fetched from the backend rather
 * than configured in the app.
 *
 * Degrades to an empty list on failure rather than throwing: on a LAN or localhost the
 * peers connect on host candidates alone, so a missing ICE list is a reason to try
 * anyway, not a reason to refuse the session. This mirrors the dashboard's behaviour.
 */
export async function fetchIceServers(signal?: AbortSignal): Promise<ICEServerMessage[]> {
  try {
    const data = await apiFetch<{ iceServers?: ICEServerMessage[] }>('/api/session/ice', { signal });
    return Array.isArray(data?.iceServers) ? data.iceServers : [];
  } catch (err) {
    log.warn('could not fetch ICE servers; continuing with host candidates only', err);
    return [];
  }
}

/**
 * sessionSocketUrl builds the signaling URL. Exported separately from the socket itself
 * so the URL construction (and its encoding) is testable and appears in exactly one
 * place.
 */
export function sessionSocketUrl(wsBase: string, deviceId: string): string {
  return `${wsBase}/ws/session?deviceId=${encodeURIComponent(deviceId)}`;
}

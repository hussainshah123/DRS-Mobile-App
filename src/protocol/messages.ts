/**
 * Payload types for each DRS message, transcribed from
 * `backend/pkg/protocol/protocol.go`, plus the narrowing functions that vouch for an
 * incoming payload before the session layer acts on it.
 *
 * Why narrow at all, when the backend is trusted? Because the backend relays agent
 * frames VERBATIM (see ws/hub.go's readLoop) — it does not re-validate them. So an
 * old, buggy or half-upgraded agent's malformed `offer` reaches this client
 * unchanged, and `setRemoteDescription(undefined)` throws inside the WebRTC native
 * module rather than at the parse site where the cause is obvious. Each `is*` function
 * below is the boundary where a bad frame becomes an ignorable frame.
 */

import type { SessionMode } from './envelope';

/**
 * protocol.SDP — an offer or answer. `sdpType` is the discriminator the Go struct
 * carries alongside the envelope type; the agent sets it and we echo the convention.
 */
export type SDPMessage = {
  sessionId: string;
  sdpType: 'offer' | 'answer';
  sdp: string;
};

/**
 * protocol.ICECandidate. Mirrors RTCIceCandidateInit so a candidate marshals straight
 * through the backend between the two peers.
 *
 * The optional fields are optional in the WebRTC sense, where null and absent mean
 * different things — a candidate with `sdpMid: null` is valid and must not be coerced
 * to `''`, which is why these are `string | null` rather than `string`.
 */
export type ICECandidateMessage = {
  sessionId: string;
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

/** protocol.SessionReady — tells us which transport the agent actually negotiated. */
export type SessionReadyMessage = {
  sessionId: string;
  mode: SessionMode;
};

/**
 * protocol.InputControl — the remote-control grant. We send this UP the signaling
 * socket; the backend overwrites `sessionId` with the session it owns and sets
 * `operator` from the authenticated JWT, so neither can be spoofed from here. We still
 * send `sessionId` to match the contract exactly.
 */
export type InputControlMessage = {
  sessionId: string;
  enabled: boolean;
  lockLocal?: boolean;
};

/**
 * protocol.Frame — one JPEG image in the view-only fallback path (spec §14).
 * `dataB64` is standard-encoding base64 of the encoded image bytes.
 */
export type FrameMessage = {
  sessionId: string;
  seq: number;
  width: number;
  height: number;
  mimeType: string;
  dataB64: string;
};

/**
 * protocol.SessionErrorMsg — the agent could not capture (no display, headless
 * service session, permission denied), or the backend rejected the session. Ends the
 * stream; the socket stays open so a retry is possible.
 */
export type SessionErrorMessage = {
  sessionId: string;
  message: string;
};

/** protocol.ICEServer — one STUN/TURN server, shaped like RTCIceServer. */
export type ICEServerMessage = {
  urls: string[];
  username?: string;
  credential?: string;
};

// ── Narrowing ────────────────────────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isSDPMessage(data: unknown): data is SDPMessage {
  return isObject(data) && isNonEmptyString(data.sdp);
}

export function isICECandidateMessage(data: unknown): data is ICECandidateMessage {
  // An EMPTY candidate string is the legitimate end-of-candidates marker, so only the
  // field's presence and type are checked here — the caller decides what an empty one
  // means.
  return isObject(data) && typeof data.candidate === 'string';
}

export function isSessionReadyMessage(data: unknown): data is SessionReadyMessage {
  return isObject(data) && (data.mode === 'webrtc' || data.mode === 'jpeg');
}

export function isFrameMessage(data: unknown): data is FrameMessage {
  return (
    isObject(data) &&
    isNonEmptyString(data.dataB64) &&
    typeof data.width === 'number' &&
    typeof data.height === 'number'
  );
}

export function isSessionErrorMessage(data: unknown): data is SessionErrorMessage {
  return isObject(data) && typeof data.message === 'string';
}

/**
 * sessionIdOf pulls the session id out of any payload that carries one. Every session
 * message in the contract has a `sessionId`, and the client learns the id this way
 * because the backend mints it server-side when the socket opens — there is no REST
 * call that hands it over first (see ws/session.go).
 */
export function sessionIdOf(data: unknown): string {
  if (isObject(data) && isNonEmptyString(data.sessionId)) {
    return data.sessionId;
  }
  return '';
}

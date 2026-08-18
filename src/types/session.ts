/**
 * Session state machine (spec §12).
 *
 * The states are deliberately more granular than "connecting / connected": during a
 * WebRTC session there are three distinct waits that fail for completely different
 * reasons, and collapsing them produces a spinner that cannot tell an operator
 * anything useful.
 *
 *   IDLE       nothing running
 *   STARTING   fetching ICE servers; nothing has touched the network yet
 *   SIGNALING  socket open — the backend has told the agent to start capturing, and we
 *              are waiting for session_ready / the offer. A stall here is the AGENT
 *              (no display, permission denied, headless service session)
 *   CONNECTING offer answered, ICE in flight. A stall here is the NETWORK (no viable
 *              candidate pair → TURN was needed and is not configured)
 *   VIEWING    media flowing, view-only
 *   CONTROLLING media flowing and the backend has authorized input
 *   RECONNECTING transport dropped but the session may recover
 *   STOPPING   tearing down deliberately
 *   ERROR      terminal; carries a reason and is retryable
 *
 * Transitions run in exactly one place — SessionController — so the UI never has to
 * infer state from a combination of booleans.
 */

import type { SessionMode } from '../protocol/envelope';

export const SessionState = {
  IDLE: 'idle',
  STARTING: 'starting',
  SIGNALING: 'signaling',
  CONNECTING: 'connecting',
  VIEWING: 'viewing',
  CONTROLLING: 'controlling',
  RECONNECTING: 'reconnecting',
  STOPPING: 'stopping',
  ERROR: 'error',
} as const;

export type SessionState = (typeof SessionState)[keyof typeof SessionState];

/** Why a session ended or failed — drives the message and whether Retry is offered. */
export const SessionFailure = {
  /** WS handshake rejected the token (401) or the role (403). Do NOT retry blindly. */
  AUTH: 'auth',
  /** The device has no live agent socket to stream from. */
  OFFLINE: 'offline',
  /** The agent reported it cannot capture (session_error). */
  AGENT: 'agent',
  /** ICE found no viable path. TURN is the fix. */
  ICE: 'ice',
  /** The signaling socket to the backend dropped. */
  SIGNALING: 'signaling',
  /** The media track ended. */
  STREAM_ENDED: 'stream_ended',
  /** Anything else. */
  UNKNOWN: 'unknown',
} as const;

export type SessionFailure = (typeof SessionFailure)[keyof typeof SessionFailure];

/** Where the remote-control grant currently stands. */
export const ControlState = {
  /** Not requested. Input is not sent and the agent would drop it anyway. */
  VIEW_ONLY: 'view_only',
  /** input_control(enabled=true) sent; waiting for the data channel to be usable. */
  REQUESTED: 'requested',
  /** Authorized by the backend AND the drs-input channel is open. */
  ENABLED: 'enabled',
  /** The transport cannot carry control at all (JPEG fallback). */
  UNAVAILABLE: 'unavailable',
} as const;

export type ControlState = (typeof ControlState)[keyof typeof ControlState];

/** The complete snapshot the session UI renders from. */
export type SessionSnapshot = {
  state: SessionState;
  control: ControlState;
  /** Server-minted; learned from the first message that carries it. Empty until then. */
  sessionId: string;
  /** '' until the agent declares it via session_ready. */
  mode: SessionMode | '';
  /** Set when state is ERROR. */
  failure: SessionFailure | null;
  /** Operator-facing reason for the current failure. */
  message: string;
  /** true while local input is being suppressed on the device. */
  lockLocal: boolean;
  /** The remote track's own pixel size — required for coordinate mapping. */
  videoSize: { width: number; height: number } | null;
  /** Whether the peer-to-peer input channel is open right now. */
  inputChannelOpen: boolean;
  /** Seconds since media started flowing. */
  elapsedSeconds: number;
};

/** hasPicture: is there something to draw? */
export function hasPicture(state: SessionState): boolean {
  return state === SessionState.VIEWING || state === SessionState.CONTROLLING;
}

/** isTerminal: has the session stopped for good (barring an explicit retry)? */
export function isTerminal(state: SessionState): boolean {
  return state === SessionState.ERROR || state === SessionState.IDLE;
}

/** isBusy: is a connection attempt in flight? Drives the spinner. */
export function isBusy(state: SessionState): boolean {
  return (
    state === SessionState.STARTING ||
    state === SessionState.SIGNALING ||
    state === SessionState.CONNECTING ||
    state === SessionState.RECONNECTING
  );
}

/**
 * Operator-facing copy for each failure, with the remedy included where there is one.
 * Kept next to the enum so a new failure mode cannot ship without its message.
 */
export const failureCopy: Record<SessionFailure, string> = {
  [SessionFailure.AUTH]:
    'Your session is no longer authorized for remote access. Sign in again to continue.',
  [SessionFailure.OFFLINE]: 'This device has no live agent. It must be online to connect.',
  [SessionFailure.AGENT]: 'The device agent could not start capturing its screen.',
  [SessionFailure.ICE]:
    'No direct path to the device could be found. A TURN relay is required on this network.',
  [SessionFailure.SIGNALING]: 'The connection to the DRS backend dropped.',
  [SessionFailure.STREAM_ENDED]: 'The remote desktop stream ended.',
  [SessionFailure.UNKNOWN]: 'The session ended unexpectedly.',
};

/**
 * Whether offering "Retry" makes sense. An auth failure must not be retried in a loop —
 * the spec is explicit that a WebSocket authentication failure should not retry
 * indefinitely (spec §15) — and it is the one case that needs a re-login instead.
 */
export function isRetryable(failure: SessionFailure | null): boolean {
  return failure !== null && failure !== SessionFailure.AUTH;
}

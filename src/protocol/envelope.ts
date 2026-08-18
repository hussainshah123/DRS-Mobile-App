/**
 * The DRS wire envelope.
 *
 * This is a TypeScript transcription of `backend/pkg/protocol/protocol.go` — the
 * SAME contract, not a second one. Every field name and message type below is copied
 * from that file; if the Go package changes, this file changes with it and nothing
 * else in the app needs to. Nothing here may be invented: an unrecognised type is
 * ignored, never guessed at (spec §17, §19).
 *
 * Wire shape, both directions:
 *
 *     { "type": "<MsgType>", "data": { ... } }
 *
 * `data` is the type-specific payload. The Go side keeps it as raw JSON so a receiver
 * can switch on `type` before decoding and so unknown future types round-trip
 * harmlessly; the decoder here preserves that property by typing it `unknown` until a
 * per-type narrowing function has vouched for it.
 */

/** protocol.ProtocolVersion — bumped only on an incompatible wire change. */
export const PROTOCOL_VERSION = 1;

/**
 * Every message type in the contract, including the agent↔backend ones this client
 * never sends. They are listed so the switch in the signaling layer is exhaustive and
 * so an agent-only frame arriving here is recognised-and-ignored rather than logged as
 * a protocol violation.
 */
export const MsgType = {
  // ── Agent → backend (this client never sends these) ────────────────────────
  HELLO: 'hello',
  HEARTBEAT: 'heartbeat',
  /** JPEG view-only fallback frame (spec §14). Relayed to us verbatim. */
  FRAME: 'frame',
  SESSION_ERROR: 'session_error',

  // ── Backend → agent (this client never sends these) ────────────────────────
  WELCOME: 'welcome',
  ERROR: 'error',
  PING: 'ping',
  START_SESSION: 'start_session',
  STOP_SESSION: 'stop_session',

  // ── WebRTC signaling, relayed verbatim between agent and viewer ────────────
  /** SDP offer. The AGENT is the offerer — it produces the media. */
  OFFER: 'offer',
  /** SDP answer. Viewer → agent. This is the only SDP we originate. */
  ANSWER: 'answer',
  /** Trickled ICE candidate, both directions. */
  ICE_CANDIDATE: 'ice_candidate',
  /** Agent → viewer: which transport was negotiated (webrtc vs. jpeg). */
  SESSION_READY: 'session_ready',

  // ── Remote control authorization ───────────────────────────────────────────
  /**
   * Grant/revoke remote input. Travels the TRUSTED backend relay, not the peer-to-peer
   * data channel, so the backend can admin-gate and audit it. This is the only thing
   * that unlocks injection on the agent (spec §13).
   */
  INPUT_CONTROL: 'input_control',
} as const;

export type MsgType = (typeof MsgType)[keyof typeof MsgType];

/** protocol.SessionMode — the live-view transport. */
export const SessionMode = {
  /** Live VP8 video over a peer-to-peer connection. The production path. */
  WEBRTC: 'webrtc',
  /** View-only JPEG frames over the signaling socket. Fallback / testing only. */
  JPEG: 'jpeg',
} as const;

export type SessionMode = (typeof SessionMode)[keyof typeof SessionMode];

/** protocol.Envelope. */
export type Envelope<T = unknown> = {
  type: MsgType;
  data?: T;
};

/**
 * encode builds a frame for the wire. Mirrors protocol.Encode: `data` is omitted
 * entirely when there is no payload (`omitempty` on the Go side), so an encoded frame
 * is byte-comparable with one the Go encoder would produce.
 */
export function encode<T>(type: MsgType, data?: T): string {
  return JSON.stringify(data === undefined ? { type } : { type, data });
}

/**
 * decodeEnvelope parses a frame without touching the payload — the direct analogue of
 * protocol.DecodeEnvelope. Returns null on anything that is not a well-formed
 * envelope (malformed JSON, missing/non-string `type`), because the backend's own
 * read loops `continue` past a bad frame rather than dropping the connection, and this
 * client must behave the same way.
 */
export function decodeEnvelope(raw: string): Envelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const candidate = parsed as { type?: unknown; data?: unknown };
  if (typeof candidate.type !== 'string') {
    return null;
  }
  return { type: candidate.type as MsgType, data: candidate.data };
}

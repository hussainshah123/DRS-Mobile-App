/**
 * Typed listener surface for react-native-webrtc.
 *
 * WHY THIS FILE EXISTS. The package ships TypeScript declarations in which every event-emitting
 * class (`RTCPeerConnection`, `MediaStreamTrack`, `RTCDataChannel`) extends an `EventTarget`
 * imported from `./vendor/event-target-shim` — but the published package contains
 * `vendor/event-target-shim/index.d.js` instead of `index.d.ts`. The declaration therefore fails to
 * resolve, and TypeScript sees those classes WITHOUT the inherited `addEventListener`, even though
 * it exists and works at runtime (it is what the library's own `on*` setters are built on).
 *
 * The options were: cast at every call site, disable type checking for the module, or declare the
 * surface once. Only the third keeps the session code type-checked. So the events this client
 * actually consumes are declared here, structurally, and `listen()` is the single narrow cast.
 *
 * If the package fixes its build, `listen()` becomes a redundant pass-through and this file can be
 * deleted without touching a line of session logic.
 */
import type { MediaStream, MediaStreamTrack } from 'react-native-webrtc';

/** A local ICE candidate as the native layer reports it. */
export type NativeIceCandidate = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

/** The data channel surface used by InputChannel. */
export type NativeDataChannel = {
  label: string;
  readyState: string;
  bufferedAmount?: number;
  send: (data: string) => void;
  onopen?: ((event: unknown) => void) | null;
  onclose?: ((event: unknown) => void) | null;
  onerror?: ((event: unknown) => void) | null;
};

/**
 * Peer connection events this client listens for. Note what is absent: no `negotiationneeded`, no
 * `signalingstatechange`. The agent is the offerer and this side never renegotiates, so reacting to
 * either would mean originating an offer the agent's Pion peer is not written to expect.
 */
export type PeerEventMap = {
  /** The remote video arrived. `streams[0]` is what RTCView renders. */
  track: { streams?: MediaStream[] | null; track?: MediaStreamTrack | null };
  /** The agent's drs-input channel. Never created by this side. */
  datachannel: { channel?: NativeDataChannel | null };
  /** One of our candidates. `candidate: null` is the end-of-gathering marker. */
  icecandidate: { candidate?: NativeIceCandidate | null };
  /** Read `connectionState` off the peer; the event itself carries nothing. */
  connectionstatechange: unknown;
};

/** Track events. 'ended' is how a deliberate stop on the agent side surfaces. */
export type TrackEventMap = {
  ended: unknown;
  mute: unknown;
  unmute: unknown;
};

type Listener<M, K extends keyof M> = (event: M[K]) => void;

type Listenable<M> = {
  addEventListener<K extends keyof M>(type: K, listener: Listener<M, K>): void;
  removeEventListener<K extends keyof M>(type: K, listener: Listener<M, K>): void;
};

/**
 * listen attaches a typed listener to a native WebRTC object.
 *
 * The double cast is deliberate and confined to this function: `unknown` first because the source
 * type genuinely lacks the member, then to the declared surface. Every caller gets a checked event
 * type from there on.
 */
export function listen<M, K extends keyof M>(
  target: object,
  type: K,
  listener: Listener<M, K>,
): void {
  (target as unknown as Listenable<M>).addEventListener(type, listener);
}

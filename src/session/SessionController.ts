/**
 * SessionController — the one place session state changes.
 *
 * It owns the signaling socket, the peer connection, the input channel, the control grant
 * and the state machine of spec §12. The UI subscribes to an immutable snapshot and issues
 * intents (`requestControl`, `sendInput`, `stop`); it never touches a socket or a peer
 * directly. That split is what keeps a live session from depending on React's render
 * timing — an ICE candidate arriving during a re-render must be applied immediately, not
 * on the next commit.
 *
 * The sequence it implements (spec §5), with who does what:
 *
 *   1. fetch ICE servers                                    ← us, over REST
 *   2. open /ws/session?deviceId=…                          ← us; THIS starts the session
 *   3. backend mints the session id, sends start_session     ← backend
 *   4. agent captures, builds its peer, creates the offer    ← agent (it is the offerer)
 *   5. session_ready, then offer                             ← agent, relayed verbatim
 *   6. setRemoteDescription → createAnswer → send answer     ← us
 *   7. trickle ICE both ways                                 ← both
 *   8. connected; video track renders                        ← us
 *
 * On the way out, closing the socket is what stops the device capturing: the backend's
 * deferred handler in ServeSession sends `stop_session` and audits the end.
 */
import { AppState, type AppStateStatus } from 'react-native';
import type { MediaStream } from 'react-native-webrtc';

import { fetchIceServers } from '../api/sessions';
import { SessionMode } from '../protocol/envelope';
import type { InputEvent } from '../protocol/inputEvent';
import type { FrameMessage, ICEServerMessage } from '../protocol/messages';
import {
  ControlState,
  SessionFailure,
  SessionState,
  failureCopy,
  type SessionSnapshot,
} from '../types/session';
import { createLogger, describeError } from '../utils/logger';
import { play } from '../utils/sound';
import { SignalingClient, SocketFailure } from '../websocket/signaling';
import { InputChannel } from '../webrtc/dataChannel';
import { hasRelay } from '../webrtc/ice';
import { shouldRenderFrame } from '../webrtc/media';
import { PeerSession } from '../webrtc/peerConnection';

const log = createLogger('session');

/**
 * How long to wait for the agent's offer after the socket opens before calling it.
 *
 * This timeout exists because a stalled agent is otherwise indistinguishable from a slow
 * one: the socket is open, the backend is happy, and nothing ever arrives. The most common
 * cause is an agent running as a headless service with no desktop to capture, which reports
 * a session_error — but a wedged capture path reports nothing at all, and without this the
 * operator watches a spinner forever.
 */
const OFFER_TIMEOUT_MS = 20000;

/**
 * Grace period after the transport drops before the session is declared failed. WebRTC
 * recovers from a brief `disconnected` on its own (a Wi-Fi-to-cellular handover is the
 * usual cause), so failing instantly would end sessions that were about to come back.
 */
const RECONNECT_GRACE_MS = 12000;

export type SessionObserver = (snapshot: SessionSnapshot) => void;

/** What the JPEG fallback path hands the UI. */
export type JpegFrame = {
  uri: string;
  width: number;
  height: number;
  seq: number;
};

export type SessionControllerOptions = {
  deviceId: string;
  token: string;
  /** Called when a WebRTC video stream arrives; null clears it. */
  onStream: (stream: MediaStream | null) => void;
  /** Called for each JPEG fallback frame. */
  onFrame: (frame: JpegFrame) => void;
};

const initialSnapshot: SessionSnapshot = {
  state: SessionState.IDLE,
  control: ControlState.VIEW_ONLY,
  sessionId: '',
  mode: '',
  failure: null,
  message: '',
  lockLocal: false,
  videoSize: null,
  inputChannelOpen: false,
  elapsedSeconds: 0,
};

export class SessionController {
  private readonly options: SessionControllerOptions;
  private signaling: SignalingClient | null = null;
  private peer: PeerSession | null = null;
  private readonly input: InputChannel;

  private snapshot: SessionSnapshot = initialSnapshot;
  private observers = new Set<SessionObserver>();

  private iceServers: ICEServerMessage[] = [];
  private offerTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;
  private appStateSub: { remove: () => void } | null = null;

  private lastFrameSeq = 0;
  /** Set the moment stop() is called, so late async work cannot resurrect the session. */
  private disposed = false;
  /** What the operator asked for, independent of whether it is currently in force. */
  private controlRequested = false;
  private lockLocalRequested = false;

  constructor(options: SessionControllerOptions) {
    this.options = options;
    this.input = new InputChannel(open => this.onInputChannelState(open));
  }

  // ── Subscription ───────────────────────────────────────────────────────────

  subscribe(observer: SessionObserver): () => void {
    this.observers.add(observer);
    observer(this.snapshot);
    return () => this.observers.delete(observer);
  }

  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  private patch(changes: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...changes };
    this.observers.forEach(observer => observer(this.snapshot));
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * start runs the whole flow. It resolves as soon as the socket is opening; everything
   * after that is driven by signaling and peer events.
   */
  async start(): Promise<void> {
    if (this.disposed || this.snapshot.state !== SessionState.IDLE) {
      return;
    }
    this.patch({ state: SessionState.STARTING, failure: null, message: '' });

    // Fetched per attempt, never cached: the TURN credential is time-limited, so a reused
    // list can fail authentication on a retry that would otherwise have worked.
    this.iceServers = await fetchIceServers();
    if (this.disposed) {
      return;
    }

    this.signaling = new SignalingClient(this.options.deviceId, this.options.token, {
      onOpen: () => this.onSocketOpen(),
      onSessionReady: (mode, sessionId) => this.onSessionReady(mode, sessionId),
      onOffer: sdp => {
        void this.onOffer(sdp.sdp);
      },
      onIceCandidate: candidate => {
        void this.peer?.addRemoteCandidate(candidate);
      },
      onFrame: frame => this.onJpegFrame(frame),
      onSessionError: message => this.onSessionError(message),
      onClose: (failure, detail) => this.onSocketClose(failure, detail),
    });

    this.patch({ state: SessionState.SIGNALING });
    this.signaling.connect();

    this.watchAppState();
  }

  private onSocketOpen(): void {
    if (this.disposed) {
      return;
    }
    // The backend has now authenticated us, minted the session id, told the agent to start
    // capturing and audited the start. From here the wait is on the agent.
    log.info('signaling open; awaiting agent offer');
    this.armOfferTimeout();
  }

  private armOfferTimeout(): void {
    this.clearOfferTimeout();
    this.offerTimer = setTimeout(() => {
      if (this.disposed || this.snapshot.state !== SessionState.SIGNALING) {
        return;
      }
      this.fail(
        SessionFailure.AGENT,
        'The device agent did not start a stream. It may have no desktop session to capture.',
      );
    }, OFFER_TIMEOUT_MS);
  }

  private clearOfferTimeout(): void {
    if (this.offerTimer) {
      clearTimeout(this.offerTimer);
      this.offerTimer = null;
    }
  }

  private onSessionReady(mode: string, sessionId: string): void {
    if (this.disposed) {
      return;
    }
    log.info(`agent negotiated transport: ${mode}`);
    this.patch({
      mode: mode === SessionMode.JPEG ? SessionMode.JPEG : SessionMode.WEBRTC,
      sessionId: sessionId || this.snapshot.sessionId,
      // The JPEG fallback has no data channel, so control can never be granted on it. Say
      // so up front rather than offering a control button that silently does nothing.
      control: mode === SessionMode.JPEG ? ControlState.UNAVAILABLE : this.snapshot.control,
    });

    if (mode === SessionMode.WEBRTC) {
      this.ensurePeer();
    }
  }

  /**
   * ensurePeer creates the peer connection lazily.
   *
   * Called from both `session_ready` and `onOffer` because the two can race — the backend
   * relays whatever the agent sends in the order it sends it, and an agent that emits its
   * offer immediately after session_ready can have both in flight. Creating on either path
   * means neither ordering breaks the session.
   */
  private ensurePeer(): PeerSession {
    if (this.peer) {
      return this.peer;
    }
    this.peer = new PeerSession(this.iceServers, {
      onRemoteStream: stream => this.onRemoteStream(stream),
      onLocalCandidate: candidate => this.signaling?.sendIceCandidate(candidate),
      onInputChannel: channel => this.onInputChannelArrived(channel),
      onConnected: () => this.onConnected(),
      onDisconnected: () => this.onDisconnected(),
      onFailed: reason => this.onIceFailed(reason),
      onTrackEnded: () => this.onTrackEnded(),
    });
    return this.peer;
  }

  private async onOffer(sdp: string): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.clearOfferTimeout();
    this.patch({ state: SessionState.CONNECTING, mode: SessionMode.WEBRTC });

    const peer = this.ensurePeer();
    try {
      const answer = await peer.acceptOffer(sdp);
      if (this.disposed) {
        return;
      }
      this.signaling?.sendAnswer(answer);
      log.info('answer relayed to agent');
    } catch (err) {
      this.fail(SessionFailure.UNKNOWN, describeError(err, 'Could not negotiate the connection.'));
    }
  }

  private onRemoteStream(stream: MediaStream): void {
    if (this.disposed) {
      return;
    }
    this.options.onStream(stream);
    this.patch({ mode: SessionMode.WEBRTC });
  }

  private onConnected(): void {
    if (this.disposed) {
      return;
    }
    this.clearReconnect();
    const wasLive = this.snapshot.state === SessionState.RECONNECTING;
    this.patch({
      state: this.controlRequested && this.input.isReady ? SessionState.CONTROLLING : SessionState.VIEWING,
      failure: null,
      message: '',
    });
    this.startElapsed();
    if (!wasLive) {
      play('connect');
    }

    // If the operator asked for control before the transport settled, honour it now that
    // there is a link to carry it.
    if (this.controlRequested) {
      this.applyControl(true, this.lockLocalRequested);
    }
  }

  private onDisconnected(): void {
    if (this.disposed || this.snapshot.state === SessionState.STOPPING) {
      return;
    }
    log.warn('transport disconnected; waiting for recovery');
    // Control must stop the instant the link is unreliable — a half-delivered drag is worse
    // than no drag. The operator's *request* is kept so control resumes on reconnect.
    this.input.setAuthorized(false);
    this.patch({
      state: SessionState.RECONNECTING,
      control: this.controlRequested ? ControlState.REQUESTED : this.snapshot.control,
    });
    this.stopElapsed();

    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      if (this.disposed || this.snapshot.state !== SessionState.RECONNECTING) {
        return;
      }
      this.fail(SessionFailure.ICE, failureCopy[SessionFailure.ICE]);
    }, RECONNECT_GRACE_MS);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private onIceFailed(reason: string): void {
    if (this.disposed) {
      return;
    }
    // Name TURN explicitly when it is missing: "connection failed" sends an operator
    // hunting through the app, when the fix is a backend config change.
    const detail = hasRelay(this.iceServers) ? reason : failureCopy[SessionFailure.ICE];
    this.fail(SessionFailure.ICE, detail);
  }

  private onTrackEnded(): void {
    if (this.disposed || this.snapshot.state === SessionState.STOPPING) {
      return;
    }
    this.fail(SessionFailure.STREAM_ENDED, failureCopy[SessionFailure.STREAM_ENDED]);
  }

  private onJpegFrame(frame: FrameMessage): void {
    if (this.disposed) {
      return;
    }
    if (!shouldRenderFrame(frame.seq, this.lastFrameSeq)) {
      return;
    }
    this.lastFrameSeq = frame.seq;
    this.clearOfferTimeout();

    const first = this.snapshot.mode !== SessionMode.JPEG;
    this.options.onFrame({
      uri: `data:${frame.mimeType || 'image/jpeg'};base64,${frame.dataB64}`,
      width: frame.width,
      height: frame.height,
      seq: frame.seq,
    });
    this.patch({
      mode: SessionMode.JPEG,
      state: SessionState.VIEWING,
      control: ControlState.UNAVAILABLE,
      videoSize: { width: frame.width, height: frame.height },
      failure: null,
      message: '',
    });
    this.startElapsed();
    if (first) {
      play('connect');
    }
  }

  private onSessionError(message: string): void {
    if (this.disposed) {
      return;
    }
    // The backend sends this pre-relay for an offline device (ws/session.go's
    // sendViewerError), and the agent sends it for a capture failure. The wording is the
    // only way to tell them apart, and they need different remedies.
    const failure = /offline/i.test(message) ? SessionFailure.OFFLINE : SessionFailure.AGENT;
    this.fail(failure, message || failureCopy[failure]);
  }

  private onSocketClose(failure: SocketFailure, detail: string): void {
    if (this.disposed || this.snapshot.state === SessionState.STOPPING) {
      return;
    }
    switch (failure) {
      case SocketFailure.UNAUTHORIZED:
        // Do NOT retry: the token is expired/revoked, or this account is not an admin. The
        // spec is explicit that an auth failure must not retry indefinitely (§15).
        this.fail(SessionFailure.AUTH, failureCopy[SessionFailure.AUTH]);
        return;
      case SocketFailure.CLOSED_BY_CLIENT:
        return;
      default:
        // The signaling socket dying ends the session even if media is briefly still
        // flowing: without it there is no way to revoke control or stop the agent, so
        // continuing would leave an unstoppable session on someone's desktop.
        this.fail(SessionFailure.SIGNALING, `${failureCopy[SessionFailure.SIGNALING]} (${detail})`);
    }
  }

  // ── Remote control ─────────────────────────────────────────────────────────

  /**
   * requestControl asks the backend to grant or revoke remote input.
   *
   * The grant goes over the signaling socket so the backend can admin-gate and audit it;
   * the agent injects nothing until it arrives. There is deliberately NO acknowledgement in
   * the protocol — the backend audits and forwards, and a rejection is impossible because
   * the socket already proved admin rights at the handshake. So "enabled" here means: the
   * grant was accepted for relay by an authenticated admin socket, AND the peer-to-peer
   * channel that carries the events is open. Both are required before a single event is
   * sent (spec §13).
   */
  requestControl(enabled: boolean, lockLocal = false): void {
    if (this.disposed) {
      return;
    }
    if (this.snapshot.control === ControlState.UNAVAILABLE) {
      log.warn('control requested on a transport that cannot carry it');
      return;
    }
    this.controlRequested = enabled;
    this.lockLocalRequested = enabled && lockLocal;
    this.applyControl(enabled, this.lockLocalRequested);
  }

  private applyControl(enabled: boolean, lockLocal: boolean): void {
    // Revoking disarms the channel FIRST, so no queued event can slip out between the
    // decision and the agent acting on it.
    if (!enabled) {
      this.input.setAuthorized(false);
    }

    const sent = this.signaling?.sendInputControl(enabled, lockLocal) ?? false;
    if (!sent) {
      // The grant never left the device, so control is not in force. Reflect that instead
      // of showing a control state the device never received.
      this.input.setAuthorized(false);
      this.patch({ control: ControlState.VIEW_ONLY, lockLocal: false });
      if (this.snapshot.state === SessionState.CONTROLLING) {
        this.patch({ state: SessionState.VIEWING });
      }
      return;
    }

    if (enabled) {
      this.input.setAuthorized(true);
      const live = this.input.isOpen;
      this.patch({
        control: live ? ControlState.ENABLED : ControlState.REQUESTED,
        lockLocal,
        state: live ? SessionState.CONTROLLING : this.snapshot.state,
      });
      if (live) {
        play('controlOn');
      }
    } else {
      this.patch({ control: ControlState.VIEW_ONLY, lockLocal: false });
      if (this.snapshot.state === SessionState.CONTROLLING) {
        this.patch({ state: SessionState.VIEWING });
      }
      play('controlOff');
    }
  }

  private onInputChannelArrived(channel: unknown): void {
    this.input.attach(channel as never);
  }

  private onInputChannelState(open: boolean): void {
    if (this.disposed) {
      return;
    }
    this.patch({ inputChannelOpen: open });

    if (open && this.controlRequested) {
      // The grant was already relayed and we were waiting on the transport — promote to
      // fully enabled now that events can actually reach the device.
      this.input.setAuthorized(true);
      this.patch({ control: ControlState.ENABLED, state: SessionState.CONTROLLING });
      play('controlOn');
      return;
    }
    if (!open && this.snapshot.control === ControlState.ENABLED) {
      this.input.setAuthorized(false);
      this.patch({ control: ControlState.REQUESTED });
      if (this.snapshot.state === SessionState.CONTROLLING) {
        this.patch({ state: SessionState.VIEWING });
      }
    }
  }

  /**
   * sendInput writes one event to the peer-to-peer channel. Silently drops unless control is
   * both granted and connected — the check is in InputChannel, so there is a single
   * authoritative gate rather than one per call site.
   */
  sendInput(event: InputEvent): void {
    this.input.send(event);
  }

  /** Whether input is currently reaching the device. */
  get canSendInput(): boolean {
    return this.input.isReady;
  }

  // ── Video geometry ─────────────────────────────────────────────────────────

  /**
   * setVideoSize records the remote picture's pixel dimensions, reported by RTCView's
   * onDimensionsChange. Coordinate mapping is impossible without it, and it changes
   * mid-session whenever the desktop's resolution does — so it is state, not a constant.
   */
  setVideoSize(width: number, height: number): void {
    if (this.disposed || width <= 0 || height <= 0) {
      return;
    }
    const current = this.snapshot.videoSize;
    if (current?.width === width && current?.height === height) {
      return;
    }
    log.info(`remote resolution ${width}×${height}`);
    this.patch({ videoSize: { width, height } });
  }

  // ── Timers ─────────────────────────────────────────────────────────────────

  private startElapsed(): void {
    if (this.elapsedTimer) {
      return;
    }
    this.elapsedTimer = setInterval(() => {
      this.patch({ elapsedSeconds: this.snapshot.elapsedSeconds + 1 });
    }, 1000);
  }

  private stopElapsed(): void {
    if (this.elapsedTimer) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
  }

  // ── App lifecycle ──────────────────────────────────────────────────────────

  /**
   * watchAppState handles backgrounding (spec §15: do not assume the peer connection
   * survives).
   *
   * Backgrounding REVOKES CONTROL rather than merely pausing it. That is a safety decision,
   * not a technical one: an operator who switches apps is not watching the remote screen,
   * and control that stays armed while nobody is looking is exactly the scenario the audit
   * trail exists to prevent. The operator's request is remembered, so returning to the
   * session re-requests the grant — through the backend, audited again.
   */
  private watchAppState(): void {
    this.appStateSub = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (this.disposed) {
        return;
      }
      if (status === 'background' || status === 'inactive') {
        if (this.snapshot.control === ControlState.ENABLED) {
          log.info('app backgrounded; releasing control');
          this.input.setAuthorized(false);
          this.signaling?.sendInputControl(false, false);
          this.patch({ control: ControlState.REQUESTED, lockLocal: false });
          if (this.snapshot.state === SessionState.CONTROLLING) {
            this.patch({ state: SessionState.VIEWING });
          }
        }
        return;
      }
      if (status === 'active') {
        // The OS may have torn the transport down while suspended. Trust the peer's own
        // state rather than assuming the session survived.
        const state = this.peer?.connectionState;
        if (state === 'failed' || state === 'closed') {
          this.fail(SessionFailure.STREAM_ENDED, 'The session did not survive being backgrounded.');
          return;
        }
        if (this.controlRequested && this.snapshot.control === ControlState.REQUESTED) {
          this.applyControl(true, this.lockLocalRequested);
        }
      }
    });
  }

  // ── Failure + teardown ─────────────────────────────────────────────────────

  private fail(failure: SessionFailure, message: string): void {
    if (this.disposed || this.snapshot.state === SessionState.ERROR) {
      return;
    }
    log.warn(`session failed (${failure}): ${message}`);
    this.clearOfferTimeout();
    this.clearReconnect();
    this.stopElapsed();
    this.input.setAuthorized(false);
    this.patch({
      state: SessionState.ERROR,
      failure,
      message,
      control:
        this.snapshot.control === ControlState.UNAVAILABLE
          ? ControlState.UNAVAILABLE
          : ControlState.VIEW_ONLY,
      lockLocal: false,
    });
    play('error');
  }

  /**
   * stop tears the session down.
   *
   * Order is deliberate: revoke control before anything else so the device cannot be left
   * armed, then close the peer (releasing the native renderer and stopping the media), then
   * close the socket — which is what triggers the backend to send `stop_session` and audit
   * the end.
   */
  stop(reason: 'operator' | 'unmount' = 'operator'): void {
    if (this.disposed) {
      return;
    }
    log.info(`stopping session (${reason})`);
    this.patch({ state: SessionState.STOPPING });

    if (this.controlRequested) {
      this.input.setAuthorized(false);
      this.signaling?.sendInputControl(false, false);
    }

    this.disposed = true;
    this.clearOfferTimeout();
    this.clearReconnect();
    this.stopElapsed();
    this.appStateSub?.remove();
    this.appStateSub = null;

    this.input.detach();
    this.peer?.close();
    this.peer = null;
    this.options.onStream(null);
    this.signaling?.close();
    this.signaling = null;

    this.patch({
      state: SessionState.IDLE,
      control: ControlState.VIEW_ONLY,
      lockLocal: false,
      inputChannelOpen: false,
    });
    if (reason === 'operator') {
      play('disconnect');
    }
    this.observers.clear();
  }
}

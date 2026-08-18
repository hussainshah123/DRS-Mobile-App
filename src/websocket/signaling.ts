/**
 * The DRS signaling client: DrsSocket plus the message routing this protocol needs.
 *
 * It converts the flat stream of envelopes into the six events a session actually cares
 * about, and enforces the direction rules the backend enforces on its side — the read
 * loop in ws/session.go forwards only `answer`, `ice_candidate` and `input_control`
 * upward and ignores everything else, so this client sends only those three. Nothing
 * here originates a message the backend would silently drop.
 *
 * It also owns SESSION ID DISCOVERY. The id is minted server-side when the socket opens
 * and is never handed over by a REST call, so it is learned from the first inbound
 * payload that carries one and then held for the life of the session. `input_control` is
 * stamped with it — although the backend overwrites that field with its own value
 * precisely so a client cannot target another session (ws/session.go: "bind to THIS
 * session; ignore any client-supplied id").
 */
import { sessionSocketUrl } from '../api/sessions';
import { getWsBase } from '../config/env';
import { MsgType, type Envelope, type SessionMode } from '../protocol/envelope';
import {
  isFrameMessage,
  isICECandidateMessage,
  isSDPMessage,
  isSessionErrorMessage,
  isSessionReadyMessage,
  sessionIdOf,
  type FrameMessage,
  type ICECandidateMessage,
  type InputControlMessage,
  type SDPMessage,
} from '../protocol/messages';
import { createLogger } from '../utils/logger';
import { DrsSocket, SocketFailure, type DrsSocketHandlers } from './drsSocket';

const log = createLogger('signaling');

export type SignalingHandlers = {
  /** The socket is up. The backend has issued `start_session` to the agent by now. */
  onOpen: () => void;
  /** The agent declared its transport. Arrives before the offer on the WebRTC path. */
  onSessionReady: (mode: SessionMode, sessionId: string) => void;
  /** The agent's SDP offer — it is the offerer, since it produces the media. */
  onOffer: (sdp: SDPMessage) => void;
  /** A trickled candidate from the agent. */
  onIceCandidate: (candidate: ICECandidateMessage) => void;
  /** A JPEG fallback frame (spec §14). Only ever arrives in `jpeg` mode. */
  onFrame: (frame: FrameMessage) => void;
  /** The agent or backend reported the session cannot continue. */
  onSessionError: (message: string) => void;
  /** Terminal. */
  onClose: (failure: SocketFailure, detail: string) => void;
};

export class SignalingClient {
  private socket: DrsSocket;
  private handlers: SignalingHandlers;
  private sessionId = '';

  constructor(deviceId: string, token: string, handlers: SignalingHandlers) {
    this.handlers = handlers;

    const socketHandlers: DrsSocketHandlers = {
      onOpen: () => this.handlers.onOpen(),
      onMessage: envelope => this.route(envelope),
      onClose: (failure, detail) => this.handlers.onClose(failure, detail),
    };
    this.socket = new DrsSocket(sessionSocketUrl(getWsBase(), deviceId), token, socketHandlers);
  }

  /**
   * connect opens the socket — which IS starting the session. The backend mints the
   * session id, tells the agent to begin capturing, and audits the start, all as a
   * consequence of this handshake succeeding.
   */
  connect(): void {
    this.socket.open();
  }

  private route(envelope: Envelope): void {
    const { type, data } = envelope;

    // Every session payload carries the server-minted id; latch the first one we see.
    const incomingId = sessionIdOf(data);
    if (incomingId && !this.sessionId) {
      this.sessionId = incomingId;
      log.info('session id assigned by backend');
    }

    switch (type) {
      case MsgType.SESSION_READY:
        if (isSessionReadyMessage(data)) {
          this.handlers.onSessionReady(data.mode, data.sessionId);
        }
        return;

      case MsgType.OFFER:
        if (isSDPMessage(data)) {
          this.handlers.onOffer(data);
        } else {
          log.warn('ignoring offer with no sdp');
        }
        return;

      case MsgType.ICE_CANDIDATE:
        if (isICECandidateMessage(data)) {
          this.handlers.onIceCandidate(data);
        }
        return;

      case MsgType.FRAME:
        if (isFrameMessage(data)) {
          this.handlers.onFrame(data);
        }
        return;

      case MsgType.SESSION_ERROR:
        if (isSessionErrorMessage(data)) {
          this.handlers.onSessionError(data.message);
        } else {
          this.handlers.onSessionError('The session ended unexpectedly.');
        }
        return;

      default:
        // Agent↔backend frames (hello/heartbeat/welcome/ping/...) are not addressed to a
        // viewer and are not errors. The envelope space is deliberately open so future
        // types round-trip; ignoring them is the contract.
        log.debug(`ignoring non-viewer message: ${type}`);
    }
  }

  /** sendAnswer relays our SDP answer to the agent. */
  sendAnswer(sdp: string): void {
    const payload: SDPMessage = { sessionId: this.sessionId, sdpType: 'answer', sdp };
    if (!this.socket.send(MsgType.ANSWER, payload)) {
      log.warn('could not send answer: socket not open');
    }
  }

  /**
   * sendIceCandidate trickles one of our candidates to the agent.
   *
   * `sdpMid` / `sdpMLineIndex` are forwarded as null rather than omitted when absent: the
   * Go struct uses pointers specifically to preserve the null-vs-missing distinction the
   * WebRTC spec cares about, and flattening it to `''` would produce a candidate the
   * agent's Pion peer cannot place on the right m-line.
   */
  sendIceCandidate(candidate: {
    candidate: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
    usernameFragment?: string | null;
  }): void {
    const payload: ICECandidateMessage = {
      sessionId: this.sessionId,
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid ?? null,
      sdpMLineIndex: candidate.sdpMLineIndex ?? null,
      usernameFragment: candidate.usernameFragment ?? null,
    };
    this.socket.send(MsgType.ICE_CANDIDATE, payload);
  }

  /**
   * sendInputControl requests or revokes remote control.
   *
   * This goes over the SIGNALING socket, never the data channel, and that is the whole
   * security model: this socket already required an admin JWT, the backend writes the
   * change to the append-only audit log before forwarding it, and the agent injects
   * nothing until it arrives (spec §13). Sending input events without this having landed
   * does nothing — the agent drops them.
   *
   * Returns false when the socket is not open, so the caller can avoid showing a control
   * state the device never received.
   */
  sendInputControl(enabled: boolean, lockLocal = false): boolean {
    const payload: InputControlMessage = { sessionId: this.sessionId, enabled, lockLocal };
    const sent = this.socket.send(MsgType.INPUT_CONTROL, payload);
    if (!sent) {
      log.warn('could not send input_control: socket not open');
    }
    return sent;
  }

  get currentSessionId(): string {
    return this.sessionId;
  }

  get isOpen(): boolean {
    return this.socket.isOpen;
  }

  /**
   * close ends the session. The backend's deferred handler sends `stop_session` to the
   * agent and audits the end when this socket closes, so this is what actually stops the
   * device capturing.
   */
  close(): void {
    this.socket.close();
  }
}

export { SocketFailure };

/**
 * The viewer's peer connection.
 *
 * DIRECTION MATTERS. The agent is the offerer — it captures the screen, so it produces
 * the media and it owns the offer, the video track and the drs-input data channel. This
 * side is purely the answerer: it never calls createOffer, never adds a track, and never
 * creates a data channel. Any of those would trigger a renegotiation the agent's Pion peer
 * is not written to expect.
 *
 * So the whole flow here is: receive offer → setRemoteDescription → createAnswer →
 * setLocalDescription → send answer, then trickle candidates both ways until the
 * connection state reaches `connected`.
 *
 * ICE CANDIDATE ORDERING is the one genuinely subtle part. The backend relays the agent's
 * candidates the moment it has them, so they routinely arrive BEFORE the offer they belong
 * to. `addIceCandidate` before `setRemoteDescription` throws, and a caught-and-discarded
 * candidate is often the one that would have completed the connection — which shows up as
 * a session that connects on a LAN and mysteriously fails across NAT. Hence the buffer.
 */
import {
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  type MediaStream,
} from 'react-native-webrtc';

import type { ICECandidateMessage, ICEServerMessage } from '../protocol/messages';
import { createLogger, describeError } from '../utils/logger';
import { INPUT_CHANNEL_LABEL } from './dataChannel';
import { buildConfiguration } from './ice';
import { listen, type PeerEventMap, type TrackEventMap } from './nativeEvents';

const log = createLogger('webrtc');

export type PeerHandlers = {
  /** The remote video arrived. Its stream is what RTCView renders. */
  onRemoteStream: (stream: MediaStream) => void;
  /** One of our candidates is ready to trickle to the agent. */
  onLocalCandidate: (candidate: {
    candidate: string;
    sdpMid: string | null;
    sdpMLineIndex: number | null;
    usernameFragment: string | null;
  }) => void;
  /** The agent's drs-input channel. Never created by this side. */
  onInputChannel: (channel: unknown) => void;
  /** Media is flowing. */
  onConnected: () => void;
  /** Transient loss — may recover on its own, so this is not terminal. */
  onDisconnected: () => void;
  /** ICE found no viable candidate pair. Terminal; TURN is the remedy. */
  onFailed: (reason: string) => void;
  /** The remote track ended (the agent stopped capturing). */
  onTrackEnded: () => void;
};

export class PeerSession {
  private pc: RTCPeerConnection | null = null;
  private handlers: PeerHandlers;
  /** Candidates that arrived before the offer. Flushed once the remote description is set. */
  private pendingCandidates: ICECandidateMessage[] = [];
  private remoteDescriptionSet = false;
  private closed = false;
  private readonly relayAvailable: boolean;

  constructor(iceServers: ICEServerMessage[], handlers: PeerHandlers) {
    this.handlers = handlers;
    this.relayAvailable = iceServers.some(s =>
      (s.urls ?? []).some(u => u.toLowerCase().startsWith('turn')),
    );

    const pc = new RTCPeerConnection(buildConfiguration(iceServers));
    this.pc = pc;

    listen<PeerEventMap, 'track'>(pc, 'track', event => {
      if (this.closed) {
        return;
      }
      // The agent publishes exactly one video track. Prefer the stream the event carries
      // — RTCView renders a *stream*, not a track, and the native renderer resolves it by
      // the stream's react tag.
      const stream = event.streams?.[0];
      if (!stream) {
        log.warn('track event carried no stream');
        return;
      }
      log.info('remote video track received');
      this.handlers.onRemoteStream(stream);

      const track = event.track;
      if (track) {
        // 'ended' is how a deliberate stop on the agent side surfaces: capture stopped,
        // but ICE is still fine, so no connection-state change would report it.
        listen<TrackEventMap, 'ended'>(track, 'ended', () => {
          if (!this.closed) {
            log.info('remote track ended');
            this.handlers.onTrackEnded();
          }
        });
      }
    });

    listen<PeerEventMap, 'datachannel'>(pc, 'datachannel', event => {
      if (this.closed) {
        return;
      }
      const channel = event.channel;
      if (channel?.label === INPUT_CHANNEL_LABEL) {
        this.handlers.onInputChannel(channel);
      }
    });

    listen<PeerEventMap, 'icecandidate'>(pc, 'icecandidate', event => {
      if (this.closed) {
        return;
      }
      const candidate = event.candidate;
      // null is the end-of-candidates marker; the agent does not need it relayed.
      if (!candidate) {
        log.debug('local ICE gathering complete');
        return;
      }
      this.handlers.onLocalCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid ?? null,
        sdpMLineIndex: candidate.sdpMLineIndex ?? null,
        usernameFragment: (candidate as { usernameFragment?: string }).usernameFragment ?? null,
      });
    });

    listen<PeerEventMap, 'connectionstatechange'>(pc, 'connectionstatechange', () => {
      if (this.closed) {
        return;
      }
      const state = pc.connectionState;
      log.info(`connection state: ${state}`);
      switch (state) {
        case 'connected':
          this.handlers.onConnected();
          break;
        case 'disconnected':
          this.handlers.onDisconnected();
          break;
        case 'failed':
          this.handlers.onFailed(
            this.relayAvailable
              ? 'The peer-to-peer connection failed, including over the TURN relay.'
              : 'No direct path to the device was found and no TURN relay is configured.',
          );
          break;
        case 'closed':
          this.handlers.onTrackEnded();
          break;
        default:
          break;
      }
    });
  }

  /**
   * acceptOffer runs the answerer half of the handshake and returns the answer SDP for the
   * caller to relay. Throws with a readable message on any negotiation failure.
   */
  async acceptOffer(sdp: string): Promise<string> {
    const pc = this.pc;
    if (!pc) {
      throw new Error('peer connection is closed');
    }
    try {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
      this.remoteDescriptionSet = true;
      log.info('remote offer applied');

      // Now that there is a remote description, the buffered candidates can be placed.
      await this.flushPendingCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      log.info('local answer set');

      // `localDescription` is the authoritative post-munging SDP; `answer.sdp` can differ
      // from what was actually applied.
      return pc.localDescription?.sdp ?? answer.sdp ?? '';
    } catch (err) {
      throw new Error(`Could not negotiate the connection: ${describeError(err)}`);
    }
  }

  /**
   * addRemoteCandidate applies (or buffers) one of the agent's candidates.
   *
   * An empty candidate string is the end-of-candidates marker and is dropped — passing it
   * to the native layer is at best a no-op and on some builds an error.
   */
  async addRemoteCandidate(message: ICECandidateMessage): Promise<void> {
    if (this.closed || !message.candidate) {
      return;
    }
    if (!this.remoteDescriptionSet) {
      this.pendingCandidates.push(message);
      log.debug(`buffered early candidate (${this.pendingCandidates.length} queued)`);
      return;
    }
    await this.applyCandidate(message);
  }

  private async flushPendingCandidates(): Promise<void> {
    if (this.pendingCandidates.length === 0) {
      return;
    }
    log.info(`applying ${this.pendingCandidates.length} buffered candidate(s)`);
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of queued) {
      await this.applyCandidate(candidate);
    }
  }

  private async applyCandidate(message: ICECandidateMessage): Promise<void> {
    try {
      await this.pc?.addIceCandidate(
        new RTCIceCandidate({
          candidate: message.candidate,
          sdpMid: message.sdpMid ?? undefined,
          sdpMLineIndex: message.sdpMLineIndex ?? undefined,
        }),
      );
    } catch (err) {
      // One rejected candidate is normal — a stale or unroutable one is expected during
      // trickling, and the others still form a pair. Only a total absence of viable
      // candidates matters, and that surfaces as connectionState 'failed'.
      log.debug('candidate rejected', err);
    }
  }

  get connectionState(): string {
    return this.pc?.connectionState ?? 'closed';
  }

  /** close tears the peer connection down, releasing the native renderer and transports. */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.pendingCandidates = [];
    const pc = this.pc;
    this.pc = null;
    if (!pc) {
      return;
    }
    try {
      pc.close();
    } catch (err) {
      log.debug('peer connection already closed', err);
    }
  }
}

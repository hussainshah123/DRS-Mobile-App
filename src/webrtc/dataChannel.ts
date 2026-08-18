/**
 * The peer-to-peer `drs-input` channel.
 *
 * The AGENT creates this channel — it is the offerer, so the channel rides its existing
 * offer and we receive it through the peer connection's `datachannel` event. This client
 * must never call createDataChannel: doing so would add a second channel the agent is not
 * listening on, and would force a renegotiation the agent does not expect.
 *
 * SECURITY. An open channel is not authorization. The agent injects nothing until an
 * `input_control(enabled=true)` has arrived down the trusted, admin-gated, audited
 * signaling path (spec §13), and it drops anything that arrives before then. This class
 * therefore refuses to send unless it has been explicitly armed, so the app never streams
 * events into a void and — more importantly — never behaves as though the channel itself
 * conferred control.
 *
 * RATE. Touch drags produce a move event per frame, and a slow or congested channel would
 * otherwise build a backlog that makes the cursor lag reality by seconds. Moves are
 * therefore COALESCED — only the newest position matters, an older one is worthless — while
 * every button, wheel and key event is sent unconditionally, because dropping a mouse-up
 * leaves a button stuck down on someone's desktop.
 */
import { serialize, type InputEvent } from '../protocol/inputEvent';
import { createLogger } from '../utils/logger';

const log = createLogger('datachannel');

/** The channel label from the contract. Must match the agent's `inputChannelLabel`. */
export const INPUT_CHANNEL_LABEL = 'drs-input';

/**
 * Minimum gap between move events, in ms. ~60/s: fast enough that a drag is smooth, low
 * enough that a mid-drag congestion spike cannot queue hundreds of stale positions.
 */
const MOVE_INTERVAL_MS = 16;

/**
 * Above this many bytes buffered we stop sending moves entirely. `bufferedAmount` growing
 * means the channel is not draining, and the correct response to a saturated control link
 * is to send less, not to queue more.
 */
const BACKPRESSURE_BYTES = 16 * 1024;

/** The subset of RTCDataChannel this needs — kept narrow so it can be faked in tests. */
export type ChannelLike = {
  label: string;
  readyState: string;
  bufferedAmount?: number;
  send: (data: string) => void;
  onopen?: ((event: unknown) => void) | null;
  onclose?: ((event: unknown) => void) | null;
  onerror?: ((event: unknown) => void) | null;
};

export class InputChannel {
  private channel: ChannelLike | null = null;
  /** Armed only by an explicit backend grant. Never by the channel opening. */
  private authorized = false;
  private pendingMove: InputEvent | null = null;
  private moveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMoveAt = 0;
  private onStateChange: (open: boolean) => void;

  constructor(onStateChange: (open: boolean) => void) {
    this.onStateChange = onStateChange;
  }

  /**
   * attach adopts the channel the agent opened. Ignores any channel with a different
   * label — an agent version that adds a second channel for another purpose must not be
   * mistaken for the input one.
   */
  attach(channel: ChannelLike): void {
    if (channel.label !== INPUT_CHANNEL_LABEL) {
      log.debug(`ignoring data channel "${channel.label}"`);
      return;
    }
    log.info('input channel attached');
    this.channel = channel;

    channel.onopen = () => {
      log.info('input channel open');
      this.onStateChange(true);
    };
    channel.onclose = () => {
      log.info('input channel closed');
      this.onStateChange(false);
    };
    channel.onerror = err => {
      log.warn('input channel error', err);
      this.onStateChange(false);
    };

    // The channel may already be open by the time we attach — the native side can deliver
    // the event after the state has moved on — so report the current state rather than
    // waiting for an onopen that has already fired.
    if (channel.readyState === 'open') {
      this.onStateChange(true);
    }
  }

  /**
   * setAuthorized arms or disarms sending. Call this ONLY in response to the backend's
   * input_control round-trip, never in response to the channel opening.
   *
   * Disarming flushes nothing and clears any queued move: after control is revoked, a
   * stale position must not land on the device.
   */
  setAuthorized(authorized: boolean): void {
    this.authorized = authorized;
    if (!authorized) {
      this.pendingMove = null;
      this.clearTimer();
    }
  }

  get isOpen(): boolean {
    return this.channel?.readyState === 'open';
  }

  /** Ready to carry input: open AND authorized by the backend. */
  get isReady(): boolean {
    return this.isOpen && this.authorized;
  }

  /**
   * send delivers one event. Moves are coalesced; everything else goes immediately.
   * Returns false when the event was dropped (not ready, or shed under backpressure).
   */
  send(event: InputEvent): boolean {
    if (!this.isReady) {
      return false;
    }
    if (event.t === 'm') {
      return this.sendMove(event);
    }
    return this.write(event);
  }

  private sendMove(event: InputEvent): boolean {
    const buffered = this.channel?.bufferedAmount ?? 0;
    if (buffered > BACKPRESSURE_BYTES) {
      // Shed the move rather than deepening the backlog. The next one will carry the
      // current position anyway, which is the only position that matters.
      this.pendingMove = null;
      return false;
    }

    const now = Date.now();
    const sinceLast = now - this.lastMoveAt;
    if (sinceLast >= MOVE_INTERVAL_MS) {
      this.lastMoveAt = now;
      this.pendingMove = null;
      return this.write(event);
    }

    // Inside the window: keep only the newest and schedule one flush. Replacing rather
    // than queueing is what stops a drag from ever running behind the finger.
    this.pendingMove = event;
    if (!this.moveTimer) {
      this.moveTimer = setTimeout(() => {
        this.moveTimer = null;
        const queued = this.pendingMove;
        this.pendingMove = null;
        if (queued && this.isReady) {
          this.lastMoveAt = Date.now();
          this.write(queued);
        }
      }, MOVE_INTERVAL_MS - sinceLast);
    }
    return true;
  }

  private write(event: InputEvent): boolean {
    try {
      this.channel?.send(serialize(event));
      return true;
    } catch (err) {
      // A channel closing mid-send throws. Not worth surfacing: the close handler will
      // report the state change, and the operator sees control drop.
      log.debug('input write failed', err);
      return false;
    }
  }

  private clearTimer(): void {
    if (this.moveTimer) {
      clearTimeout(this.moveTimer);
      this.moveTimer = null;
    }
  }

  /**
   * detach drops the channel. The channel itself is closed transitively when the peer
   * connection closes, so this only releases our references and cancels pending work.
   */
  detach(): void {
    this.clearTimer();
    this.pendingMove = null;
    this.authorized = false;
    if (this.channel) {
      this.channel.onopen = null;
      this.channel.onclose = null;
      this.channel.onerror = null;
      this.channel = null;
    }
  }
}

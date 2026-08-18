/**
 * The input-authorization gate (spec §13).
 *
 * This is the security test. The invariant it protects: an open `drs-input` data channel is NOT
 * authorization. The channel is peer-to-peer and the agent creates it as part of its offer, so it
 * opens as a side effect of the video connecting — before anyone has been granted anything. Control
 * comes only from an `input_control` grant that travelled the backend's trusted, admin-gated,
 * audited relay.
 *
 * The agent enforces this on its side (input.Controller starts disabled and drops events until
 * Enable(true)). These tests assert this client does not rely on that: it refuses to put a single
 * event on the wire until it has been explicitly armed. Two independent gates is the point — a
 * regression in either one alone cannot move someone's mouse.
 */
import { InputChannel, INPUT_CHANNEL_LABEL, type ChannelLike } from '../src/webrtc/dataChannel';
import { mouseDown, mouseMove } from '../src/protocol/inputEvent';
import { MouseButton } from '../src/protocol/inputEvent';

/** A fake channel that records what was written, so "did anything reach the wire" is observable. */
function fakeChannel(label = INPUT_CHANNEL_LABEL, readyState = 'open'): ChannelLike & { sent: string[] } {
  return {
    label,
    readyState,
    bufferedAmount: 0,
    sent: [] as string[],
    send(data: string) {
      this.sent.push(data);
    },
    onopen: null,
    onclose: null,
    onerror: null,
  };
}

describe('InputChannel authorization', () => {
  it('sends NOTHING on an open channel that has not been authorized', () => {
    const channel = fakeChannel();
    const input = new InputChannel(() => {});
    input.attach(channel);

    expect(input.isOpen).toBe(true);
    // Open but not armed — this is the exact state right after the video connects.
    expect(input.isReady).toBe(false);
    expect(input.send(mouseMove(0.5, 0.5))).toBe(false);
    expect(input.send(mouseDown(MouseButton.LEFT, 0.5, 0.5))).toBe(false);
    expect(channel.sent).toEqual([]);
  });

  it('sends only after an explicit grant', () => {
    const channel = fakeChannel();
    const input = new InputChannel(() => {});
    input.attach(channel);

    input.setAuthorized(true);
    expect(input.isReady).toBe(true);
    expect(input.send(mouseDown(MouseButton.LEFT, 0.25, 0.75))).toBe(true);
    expect(JSON.parse(channel.sent[0])).toEqual({ t: 'md', b: 0, x: 0.25, y: 0.75 });
  });

  it('stops sending the instant the grant is revoked', () => {
    const channel = fakeChannel();
    const input = new InputChannel(() => {});
    input.attach(channel);
    input.setAuthorized(true);
    input.send(mouseDown(MouseButton.LEFT, 0.1, 0.1));
    const countWhileAuthorized = channel.sent.length;

    input.setAuthorized(false);
    expect(input.send(mouseMove(0.9, 0.9))).toBe(false);
    expect(channel.sent).toHaveLength(countWhileAuthorized);
  });

  it('refuses to send on a channel that is not open, even when authorized', () => {
    const channel = fakeChannel(INPUT_CHANNEL_LABEL, 'connecting');
    const input = new InputChannel(() => {});
    input.attach(channel);
    input.setAuthorized(true);

    // Both conditions are required; authorization alone is not enough.
    expect(input.isReady).toBe(false);
    expect(input.send(mouseMove(0.5, 0.5))).toBe(false);
    expect(channel.sent).toEqual([]);
  });

  it('ignores a data channel with any other label', () => {
    // An agent version that adds a second channel for another purpose must not be mistaken for the
    // input one.
    const channel = fakeChannel('drs-telemetry');
    const input = new InputChannel(() => {});
    input.attach(channel);

    expect(input.isOpen).toBe(false);
    input.setAuthorized(true);
    expect(input.send(mouseMove(0.5, 0.5))).toBe(false);
    expect(channel.sent).toEqual([]);
  });

  it('reports the channel opening without arming itself', () => {
    // The state callback exists so the UI can show "control pending" vs "control enabled". It must
    // not be mistaken for a grant.
    const states: boolean[] = [];
    const channel = fakeChannel();
    const input = new InputChannel(open => states.push(open));
    input.attach(channel);

    expect(states).toEqual([true]);
    expect(input.isReady).toBe(false);
  });

  it('drops a queued move when the grant is withdrawn mid-drag', () => {
    // Coalesced moves are held briefly before being flushed. A stale position must not land on the
    // device after control was released.
    jest.useFakeTimers();
    const channel = fakeChannel();
    const input = new InputChannel(() => {});
    input.attach(channel);
    input.setAuthorized(true);

    input.send(mouseMove(0.1, 0.1)); // sent immediately
    input.send(mouseMove(0.2, 0.2)); // inside the rate window → queued
    const beforeRevoke = channel.sent.length;

    input.setAuthorized(false);
    jest.advanceTimersByTime(100);

    expect(channel.sent).toHaveLength(beforeRevoke);
    jest.useRealTimers();
  });

  it('detaching clears authorization, so a re-attached channel starts locked', () => {
    const channel = fakeChannel();
    const input = new InputChannel(() => {});
    input.attach(channel);
    input.setAuthorized(true);
    input.detach();

    const next = fakeChannel();
    input.attach(next);
    expect(input.isReady).toBe(false);
    expect(input.send(mouseMove(0.5, 0.5))).toBe(false);
    expect(next.sent).toEqual([]);
  });
});

describe('InputChannel rate control', () => {
  it('coalesces moves but never drops a button event', () => {
    jest.useFakeTimers();
    const channel = fakeChannel();
    const input = new InputChannel(() => {});
    input.attach(channel);
    input.setAuthorized(true);

    input.send(mouseMove(0.1, 0.1));
    for (let i = 0; i < 20; i++) {
      input.send(mouseMove(0.1 + i / 100, 0.2));
    }
    // A stuck button is far worse than a stuttery cursor, so button events bypass the rate limit
    // entirely.
    input.send(mouseDown(MouseButton.LEFT, 0.5, 0.5));

    const buttons = channel.sent.filter(raw => JSON.parse(raw).t === 'md');
    expect(buttons).toHaveLength(1);
    // Twenty queued moves must not have produced twenty writes.
    const moves = channel.sent.filter(raw => JSON.parse(raw).t === 'm');
    expect(moves.length).toBeLessThan(21);

    jest.advanceTimersByTime(50);
    jest.useRealTimers();
  });

  it('sheds moves under backpressure rather than deepening the backlog', () => {
    const channel = fakeChannel();
    channel.bufferedAmount = 64 * 1024; // channel is not draining
    const input = new InputChannel(() => {});
    input.attach(channel);
    input.setAuthorized(true);

    expect(input.send(mouseMove(0.5, 0.5))).toBe(false);
    expect(channel.sent).toEqual([]);
  });
});

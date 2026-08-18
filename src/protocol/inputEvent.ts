/**
 * The `drs-input` data-channel contract (spec §9), transcribed from
 * protocol.InputEvent.
 *
 * Two things make this different from every other message in the app:
 *
 *  1. It is NOT wrapped in an Envelope. The Go doc comment is explicit: InputEvent
 *     "is NOT sent as an Envelope". It goes on the wire as the bare compact object,
 *     because at mouse-move rates the envelope's overhead is the difference between
 *     responsive and laggy.
 *
 *  2. It does not travel the backend. It goes peer-to-peer over the WebRTC data
 *     channel named "drs-input", which the AGENT creates as offerer. The backend never
 *     sees these events — which is exactly why the agent injects nothing until an
 *     `input_control` grant has arrived down the trusted signaling path instead
 *     (spec §13).
 *
 * Field names are single letters because they are sent thousands of times per session.
 * Do not rename them for readability; the agent decodes these exact keys
 * (agent/internal/input/input.go).
 */

/** Mouse button ids as the agent numbers them. */
export const MouseButton = {
  LEFT: 0,
  RIGHT: 1,
  MIDDLE: 2,
} as const;

export type MouseButton = (typeof MouseButton)[keyof typeof MouseButton];

/** Mouse move → x, y. */
export type MouseMoveEvent = { t: 'm'; x: number; y: number };
/** Button down → b, x, y. */
export type MouseDownEvent = { t: 'md'; b: MouseButton; x: number; y: number };
/** Button up → b, x, y. */
export type MouseUpEvent = { t: 'mu'; b: MouseButton; x: number; y: number };
/** Wheel → dx, dy. Deltas in the browser's sense; the agent maps sign and scale. */
export type WheelEvent = { t: 'w'; dx: number; dy: number };
/** Key down → code (KeyboardEvent.code), key (the produced character). */
export type KeyDownEvent = { t: 'kd'; code: string; key: string };
/** Key up → code, key. */
export type KeyUpEvent = { t: 'ku'; code: string; key: string };

export type InputEvent =
  | MouseMoveEvent
  | MouseDownEvent
  | MouseUpEvent
  | WheelEvent
  | KeyDownEvent
  | KeyUpEvent;

/**
 * Coordinates are rounded to 4 decimals before they go on the wire.
 *
 * Normalized coordinates carry ~15 significant digits by default, and at 1/10000 of a
 * screen the extra digits are far below one physical pixel on any display that exists —
 * they are pure payload. Trimming them cuts a mouse-move event roughly in half, which
 * matters at the rate these are sent.
 */
function q(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function mouseMove(x: number, y: number): MouseMoveEvent {
  return { t: 'm', x: q(x), y: q(y) };
}

export function mouseDown(button: MouseButton, x: number, y: number): MouseDownEvent {
  return { t: 'md', b: button, x: q(x), y: q(y) };
}

export function mouseUp(button: MouseButton, x: number, y: number): MouseUpEvent {
  return { t: 'mu', b: button, x: q(x), y: q(y) };
}

export function wheel(dx: number, dy: number): WheelEvent {
  return { t: 'w', dx: q(dx), dy: q(dy) };
}

export function keyDown(code: string, key: string): KeyDownEvent {
  return { t: 'kd', code, key };
}

export function keyUp(code: string, key: string): KeyUpEvent {
  return { t: 'ku', code, key };
}

/** serialize renders one event for the data channel. */
export function serialize(event: InputEvent): string {
  return JSON.stringify(event);
}

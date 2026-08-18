/**
 * Touch gestures → InputEvent.
 *
 * A desktop mouse and a touchscreen are not the same device, and pretending otherwise is
 * where mobile remote-control apps usually fall down. A mouse reports position continuously
 * and buttons separately; a finger reports position only while it is down, has no hover, no
 * right button, and no scroll wheel. This module is the translation, and it supports two
 * distinct interaction models because neither one covers every task:
 *
 *   DIRECT ('touch') — the finger IS the cursor. Tap where you want to click. Immediate and
 *   obvious, and the right default. Its limits are physical: the fingertip covers ~40px of a
 *   phone-sized view, so a 12px window close button cannot be hit reliably, and the finger
 *   hides what it is about to click.
 *
 *   TRACKPAD ('trackpad') — drag anywhere to move the cursor relatively, tap to click where
 *   the cursor already is. Nothing is occluded, and with sensitivity above 1 a 4K desktop is
 *   crossable in one swipe. This is how a small target actually gets hit.
 *
 * Both modes emit the SAME wire events; the difference is entirely in how a touch becomes a
 * coordinate. Everything here is pure: it takes gesture geometry and returns events, so the
 * mapping can be tested without a running peer connection.
 */
import {
  MouseButton,
  mouseDown,
  mouseMove,
  mouseUp,
  wheel,
  type InputEvent,
} from '../protocol/inputEvent';
import { advance, toNormalized, type NormalizedPoint, type Size } from '../utils/coordinates';

export type PointerMode = 'touch' | 'trackpad';

/**
 * A tap must stay within this radius (in points) and this duration to count as a click
 * rather than a drag. 12pt / 320ms are the platform conventions for a tap: tighter and a
 * normal thumb press registers as a drag, looser and a short flick clicks by accident.
 */
const TAP_SLOP_PT = 12;
const TAP_TIMEOUT_MS = 320;

/** Long-press duration for a right click. Matches the OS context-menu delay. */
export const LONG_PRESS_MS = 500;

/**
 * Wheel deltas the agent understands. The contract says "browser deltas; agent maps sign and
 * scale", and a browser wheel notch is ~100 units, so finger travel is converted at roughly
 * one notch per 40pt — which makes a full-screen swipe scroll about as far as it would in a
 * native list.
 */
const SCROLL_UNITS_PER_POINT = 100 / 40;

export type MapperGeometry = {
  /** The container the video is drawn into. */
  container: Size;
  /** The remote picture's own pixel size. null until the track reports it. */
  video: Size | null;
};

export type GestureStart = {
  /** Container-local coordinates of the touch. */
  x: number;
  y: number;
  timestamp: number;
};

export type GestureMove = {
  x: number;
  y: number;
  /** Total translation since the gesture began, in container points. */
  dx: number;
  dy: number;
  timestamp: number;
};

/**
 * PointerMapper holds the little state a gesture needs: where the virtual cursor is, whether
 * a drag has been recognised, and whether a button is currently held.
 *
 * The virtual cursor exists because trackpad mode has no absolute reference — and it is kept
 * in sync in DIRECT mode too, so switching modes mid-session does not teleport the cursor
 * away from where the operator last saw it.
 */
export class PointerMapper {
  private mode: PointerMode;
  private sensitivity: number;
  private geometry: MapperGeometry;

  /** Normalized cursor position. Centre is the only sane starting point. */
  private cursor: NormalizedPoint = { x: 0.5, y: 0.5 };
  private start: GestureStart | null = null;
  private movedBeyondSlop = false;
  /** Set while a button is held, so the release can be emitted at the right place. */
  private heldButton: MouseButton | null = null;

  constructor(geometry: MapperGeometry, mode: PointerMode = 'touch', sensitivity = 1.6) {
    this.geometry = geometry;
    this.mode = mode;
    this.sensitivity = sensitivity;
  }

  setGeometry(geometry: MapperGeometry): void {
    this.geometry = geometry;
  }

  setMode(mode: PointerMode): void {
    this.mode = mode;
  }

  setSensitivity(sensitivity: number): void {
    this.sensitivity = Math.max(0.5, Math.min(4, sensitivity));
  }

  getCursor(): NormalizedPoint {
    return this.cursor;
  }

  /** True once the touch has travelled far enough to be a drag rather than a tap. */
  get isDragging(): boolean {
    return this.movedBeyondSlop;
  }

  get isButtonHeld(): boolean {
    return this.heldButton !== null;
  }

  private get video(): Size | null {
    return this.geometry.video;
  }

  /**
   * onTouchStart begins a gesture.
   *
   * In DIRECT mode the cursor jumps to the touch point immediately and a move event is
   * emitted, so the remote cursor is already in place before any click — without it, a
   * single tap would click wherever the cursor happened to be left, which is the classic
   * "my tap clicked the wrong thing" bug.
   *
   * No button is pressed yet: a tap and a drag are indistinguishable at this instant, and
   * pressing now would turn every scroll into a text selection.
   */
  onTouchStart(point: GestureStart): InputEvent[] {
    this.start = point;
    this.movedBeyondSlop = false;

    if (!this.video) {
      return [];
    }
    if (this.mode === 'touch') {
      const normalized = toNormalized(point, this.geometry.container, this.video, 'reject');
      if (!normalized) {
        // The touch landed on the letterbox — not a point on the desktop at all. Reject
        // rather than clamp, so a tap on the black bar cannot hit the taskbar edge.
        this.start = null;
        return [];
      }
      this.cursor = normalized;
      return [mouseMove(normalized.x, normalized.y)];
    }
    return [];
  }

  /**
   * onTouchMove moves the cursor. DIRECT tracks the finger absolutely; TRACKPAD accumulates
   * the delta onto the virtual cursor.
   *
   * DIRECT uses 'clamp' here, unlike onTouchStart's 'reject': a drag that began on the
   * picture and wandered onto the letterbox should slide along the desktop edge, not stop
   * dead mid-selection.
   */
  onTouchMove(move: GestureMove): InputEvent[] {
    if (!this.start || !this.video) {
      return [];
    }
    if (!this.movedBeyondSlop) {
      const travel = Math.hypot(move.x - this.start.x, move.y - this.start.y);
      if (travel > TAP_SLOP_PT) {
        this.movedBeyondSlop = true;
      }
    }

    const next =
      this.mode === 'touch'
        ? toNormalized(move, this.geometry.container, this.video, 'clamp')
        : advance(
            this.cursor,
            { dx: move.dx - this.lastTrackpadDx, dy: move.dy - this.lastTrackpadDy },
            this.geometry.container,
            this.video,
            this.sensitivity,
          );

    if (this.mode === 'trackpad') {
      this.lastTrackpadDx = move.dx;
      this.lastTrackpadDy = move.dy;
    }
    if (!next) {
      return [];
    }
    this.cursor = next;
    return [mouseMove(next.x, next.y)];
  }

  /**
   * React Native's PanResponder reports CUMULATIVE translation (`gestureState.dx`), not a
   * per-frame delta. Trackpad mode needs the increment, so the previous cumulative value is
   * kept and subtracted. Reset at the start of every gesture.
   */
  private lastTrackpadDx = 0;
  private lastTrackpadDy = 0;

  /**
   * onTouchEnd resolves the gesture.
   *
   * A tap (short, small travel) becomes a down/up pair at the cursor. A drag has already
   * emitted its moves, so it only needs its button released — if one was pressed by
   * `beginDrag`.
   */
  onTouchEnd(timestamp: number): InputEvent[] {
    const start = this.start;
    this.start = null;
    this.lastTrackpadDx = 0;
    this.lastTrackpadDy = 0;

    const events: InputEvent[] = [];

    // Release a held button first — leaving one down would strand it on the desktop.
    if (this.heldButton !== null) {
      events.push(mouseUp(this.heldButton, this.cursor.x, this.cursor.y));
      this.heldButton = null;
      this.movedBeyondSlop = false;
      return events;
    }

    if (!start) {
      this.movedBeyondSlop = false;
      return events;
    }
    const wasTap = !this.movedBeyondSlop && timestamp - start.timestamp <= TAP_TIMEOUT_MS;
    this.movedBeyondSlop = false;

    if (wasTap) {
      events.push(mouseDown(MouseButton.LEFT, this.cursor.x, this.cursor.y));
      events.push(mouseUp(MouseButton.LEFT, this.cursor.x, this.cursor.y));
    }
    return events;
  }

  /** onTouchCancel releases anything held. The OS took the gesture (a call, a notification). */
  onTouchCancel(): InputEvent[] {
    this.start = null;
    this.movedBeyondSlop = false;
    this.lastTrackpadDx = 0;
    this.lastTrackpadDy = 0;
    if (this.heldButton !== null) {
      const button = this.heldButton;
      this.heldButton = null;
      return [mouseUp(button, this.cursor.x, this.cursor.y)];
    }
    return [];
  }

  /**
   * beginDrag presses a button at the current cursor and holds it, so subsequent moves drag
   * rather than hover. Driven by the long-press recogniser for a press-drag-release, and by
   * the explicit drag toggle in the toolbar.
   */
  beginDrag(button: MouseButton = MouseButton.LEFT): InputEvent[] {
    if (this.heldButton !== null) {
      return [];
    }
    this.heldButton = button;
    return [mouseDown(button, this.cursor.x, this.cursor.y)];
  }

  /** endDrag releases a held button. */
  endDrag(): InputEvent[] {
    if (this.heldButton === null) {
      return [];
    }
    const button = this.heldButton;
    this.heldButton = null;
    return [mouseUp(button, this.cursor.x, this.cursor.y)];
  }

  /**
   * rightClick emits a full down/up at the cursor. Bound to long-press, which is the only
   * gesture a touchscreen has for "the other button".
   */
  rightClick(): InputEvent[] {
    return [
      mouseDown(MouseButton.RIGHT, this.cursor.x, this.cursor.y),
      mouseUp(MouseButton.RIGHT, this.cursor.x, this.cursor.y),
    ];
  }

  /** doubleClick emits two down/up pairs at the cursor. */
  doubleClick(): InputEvent[] {
    return [
      mouseDown(MouseButton.LEFT, this.cursor.x, this.cursor.y),
      mouseUp(MouseButton.LEFT, this.cursor.x, this.cursor.y),
      mouseDown(MouseButton.LEFT, this.cursor.x, this.cursor.y),
      mouseUp(MouseButton.LEFT, this.cursor.x, this.cursor.y),
    ];
  }

  /**
   * scroll converts two-finger travel into wheel deltas.
   *
   * The sign is inverted so the gesture is NATURAL — dragging two fingers up moves the
   * content up, which is what every touch platform does and the opposite of what a raw
   * positive delta means to a desktop.
   */
  scroll(dx: number, dy: number): InputEvent[] {
    const wheelDx = -dx * SCROLL_UNITS_PER_POINT;
    const wheelDy = -dy * SCROLL_UNITS_PER_POINT;
    if (Math.abs(wheelDx) < 1 && Math.abs(wheelDy) < 1) {
      return [];
    }
    return [wheel(wheelDx, wheelDy)];
  }

  /** moveTo places the cursor at an absolute normalized point (used by the D-pad nudges). */
  moveTo(point: NormalizedPoint): InputEvent[] {
    this.cursor = point;
    return [mouseMove(point.x, point.y)];
  }
}

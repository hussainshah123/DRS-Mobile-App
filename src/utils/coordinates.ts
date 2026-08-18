/**
 * Touch → desktop coordinate mapping (spec §11).
 *
 * The remote desktop is drawn with `objectFit: 'contain'`, so the picture almost
 * never fills its container: a 16:9 desktop inside a portrait phone viewport is a
 * wide band with black bars above and below. The naive mapping — touch.x divided by
 * container width — is therefore wrong by exactly the letterbox offset, and wrong by
 * a *different* amount after every rotation and every desktop resolution change.
 * That error is invisible in the middle of the screen and grows toward the edges,
 * which is why it survives casual testing and then misses every window close button.
 *
 * So: compute the real displayed rectangle, subtract its origin, divide by its size,
 * and only then normalize to the 0..1 the agent expects.
 *
 * These are pure functions with no React or native dependency — that is what lets
 * the mapping be unit-tested against known letterbox geometries instead of verified
 * by poking at a running device.
 */

/** Size of the view the video is drawn into, in device-independent points. */
export type Size = { width: number; height: number };

/** The video's own pixel dimensions, as reported by the WebRTC track. */
export type VideoSize = Size;

/** The rectangle the picture actually occupies inside the container. */
export type VideoRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** A point normalized to the streamed image: 0..1 on both axes. */
export type NormalizedPoint = { x: number; y: number };

export function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * fittedRect returns where a `video`-sized picture lands inside a `container` under
 * contain/fit scaling, centred on both axes.
 *
 * Returns null when either size is degenerate. A caller MUST treat null as "not
 * mappable yet" and drop the event rather than guessing — during the first frames of
 * a session the track's dimensions are legitimately unknown, and a guess there sends
 * a click to the wrong place on a live machine.
 */
export function fittedRect(container: Size, video: VideoSize): VideoRect | null {
  if (
    !container ||
    !video ||
    container.width <= 0 ||
    container.height <= 0 ||
    video.width <= 0 ||
    video.height <= 0
  ) {
    return null;
  }
  // Contain: the smaller ratio wins, so the whole picture fits with bars on the
  // axis that has slack.
  const scale = Math.min(container.width / video.width, container.height / video.height);
  const width = video.width * scale;
  const height = video.height * scale;
  return {
    x: (container.width - width) / 2,
    y: (container.height - height) / 2,
    width,
    height,
  };
}

/**
 * toNormalized maps a touch point (in container-local coordinates, i.e. what
 * `locationX`/`locationY` give you) to the 0..1 space of the streamed image.
 *
 * `mode` decides what happens to a touch that lands on the letterbox bars:
 *
 *   • 'reject' (default) — returns null. Correct for taps and drags: a tap on the
 *     black bar is not a click anywhere on the desktop, and synthesizing one at the
 *     nearest edge would let a mistimed tap hit the taskbar.
 *
 *   • 'clamp' — pins to the nearest edge. Correct for a drag already in progress and
 *     for the trackpad's relative motion, where the pointer should slide along the
 *     edge rather than stop dead or teleport.
 */
export function toNormalized(
  point: { x: number; y: number },
  container: Size,
  video: VideoSize,
  mode: 'reject' | 'clamp' = 'reject',
): NormalizedPoint | null {
  const rect = fittedRect(container, video);
  if (!rect) {
    return null;
  }
  const x = (point.x - rect.x) / rect.width;
  const y = (point.y - rect.y) / rect.height;

  if (mode === 'reject' && (x < 0 || x > 1 || y < 0 || y > 1)) {
    return null;
  }
  return { x: clamp01(x), y: clamp01(y) };
}

/**
 * advance moves a normalized point by a gesture delta expressed in container points
 * — the relative "trackpad" mapping.
 *
 * The delta is divided by the DISPLAYED size, not the container size, so one point of
 * finger travel moves the cursor one displayed point regardless of letterboxing. It
 * is scaled by `sensitivity` because a phone-sized viewport showing a 4K desktop
 * needs more than 1:1 to cross it in one swipe.
 *
 * Result is clamped rather than rejected: unlike an absolute tap there are no bars to
 * fall off, so the cursor should stop at the desktop edge and stay there.
 */
export function advance(
  from: NormalizedPoint,
  delta: { dx: number; dy: number },
  container: Size,
  video: VideoSize,
  sensitivity = 1,
): NormalizedPoint | null {
  const rect = fittedRect(container, video);
  if (!rect) {
    return null;
  }
  return {
    x: clamp01(from.x + (delta.dx * sensitivity) / rect.width),
    y: clamp01(from.y + (delta.dy * sensitivity) / rect.height),
  };
}

/**
 * containsPoint reports whether a container-local point is over the picture rather
 * than the letterbox. Used to decide whether a gesture should start at all.
 */
export function containsPoint(
  point: { x: number; y: number },
  container: Size,
  video: VideoSize,
): boolean {
  const rect = fittedRect(container, video);
  if (!rect) {
    return false;
  }
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * describeAspect formats the fit for the session info panel, e.g. "1920×1080 · 16:9".
 * Purely cosmetic, but it is the fastest way for an operator to notice the agent
 * switched resolution mid-session.
 */
export function describeAspect(video: VideoSize | null): string {
  if (!video || video.width <= 0 || video.height <= 0) {
    return '—';
  }
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(video.width, video.height) || 1;
  return `${video.width}×${video.height} · ${video.width / d}:${video.height / d}`;
}

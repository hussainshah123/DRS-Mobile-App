/**
 * Coordinate mapping (spec §11).
 *
 * These are the tests that matter most in the app, because the failure they guard against is
 * SILENT: a letterbox offset that is ignored produces taps that are correct in the middle of the
 * screen and progressively wrong toward the edges. That passes any casual "does clicking work"
 * check and then misses every window close button.
 *
 * So the assertions are anchored on known geometries where the right answer can be computed by
 * hand: a 16:9 desktop in a square viewport (bars top and bottom), and a square desktop in a wide
 * viewport (bars left and right).
 */
import {
  advance,
  clamp01,
  containsPoint,
  describeAspect,
  fittedRect,
  toNormalized,
} from '../src/utils/coordinates';

describe('fittedRect', () => {
  it('letterboxes a wide desktop in a square viewport', () => {
    // 1920×1080 into 400×400 → scale 400/1920, height 225, bars of 87.5 top and bottom.
    const rect = fittedRect({ width: 400, height: 400 }, { width: 1920, height: 1080 });
    expect(rect).toEqual({ x: 0, y: 87.5, width: 400, height: 225 });
  });

  it('pillarboxes a square desktop in a wide viewport', () => {
    const rect = fittedRect({ width: 800, height: 400 }, { width: 1000, height: 1000 });
    expect(rect).toEqual({ x: 200, y: 0, width: 400, height: 400 });
  });

  it('fills exactly when the aspect ratios match', () => {
    const rect = fittedRect({ width: 640, height: 360 }, { width: 1920, height: 1080 });
    expect(rect).toEqual({ x: 0, y: 0, width: 640, height: 360 });
  });

  it('returns null for a degenerate size rather than dividing by zero', () => {
    // This is the real state during the first frames of a session, before the track reports its
    // dimensions. Returning null forces callers to drop the event instead of guessing.
    expect(fittedRect({ width: 0, height: 0 }, { width: 1920, height: 1080 })).toBeNull();
    expect(fittedRect({ width: 400, height: 400 }, { width: 0, height: 0 })).toBeNull();
  });
});

describe('toNormalized', () => {
  const container = { width: 400, height: 400 };
  const video = { width: 1920, height: 1080 };

  it('maps the picture centre to 0.5, 0.5', () => {
    expect(toNormalized({ x: 200, y: 200 }, container, video)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('maps the picture corners to the extremes', () => {
    // The picture starts at y=87.5, not y=0 — this is exactly the offset a naive mapping drops.
    expect(toNormalized({ x: 0, y: 87.5 }, container, video)).toEqual({ x: 0, y: 0 });
    expect(toNormalized({ x: 400, y: 312.5 }, container, video)).toEqual({ x: 1, y: 1 });
  });

  it('does NOT map a naive divide-by-height point to the top of the desktop', () => {
    // Guards the specific bug: y=0 is the top of the CONTAINER, which is black bar, not desktop.
    expect(toNormalized({ x: 200, y: 0 }, container, video)).toBeNull();
  });

  it('rejects a touch on the letterbox bars by default', () => {
    expect(toNormalized({ x: 200, y: 40 }, container, video)).toBeNull();
    expect(toNormalized({ x: 200, y: 380 }, container, video)).toBeNull();
  });

  it('clamps to the nearest edge when asked, for a drag already in progress', () => {
    expect(toNormalized({ x: 200, y: 40 }, container, video, 'clamp')).toEqual({ x: 0.5, y: 0 });
    expect(toNormalized({ x: 200, y: 380 }, container, video, 'clamp')).toEqual({ x: 0.5, y: 1 });
  });

  it('returns null when the video size is unknown', () => {
    expect(toNormalized({ x: 200, y: 200 }, container, { width: 0, height: 0 })).toBeNull();
  });
});

describe('advance', () => {
  const container = { width: 400, height: 400 };
  const video = { width: 1920, height: 1080 };

  it('divides the delta by the DISPLAYED size, not the container size', () => {
    // The picture is 225pt tall inside a 400pt container. A 22.5pt drag is a tenth of the picture,
    // so y must move by 0.1 — dividing by 400 would give 0.05625 and make vertical drags feel
    // sluggish in a way that is easy to mistake for latency.
    const next = advance({ x: 0.5, y: 0.5 }, { dx: 0, dy: 22.5 }, container, video);
    expect(next?.y).toBeCloseTo(0.6, 5);
  });

  it('scales by sensitivity', () => {
    const next = advance({ x: 0.5, y: 0.5 }, { dx: 40, dy: 0 }, container, video, 2);
    expect(next?.x).toBeCloseTo(0.7, 5);
  });

  it('clamps at the desktop edge instead of rejecting', () => {
    // Unlike an absolute tap there are no bars to fall off, so the cursor should stop, not vanish.
    const next = advance({ x: 0.95, y: 0.5 }, { dx: 1000, dy: 0 }, container, video);
    expect(next).toEqual({ x: 1, y: 0.5 });
  });
});

describe('containsPoint', () => {
  it('distinguishes the picture from the bars', () => {
    const container = { width: 400, height: 400 };
    const video = { width: 1920, height: 1080 };
    expect(containsPoint({ x: 200, y: 200 }, container, video)).toBe(true);
    expect(containsPoint({ x: 200, y: 10 }, container, video)).toBe(false);
  });
});

describe('clamp01', () => {
  it('bounds the range and treats NaN as 0', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.42)).toBe(0.42);
    // A NaN would otherwise reach the wire and move the remote cursor somewhere undefined.
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe('describeAspect', () => {
  it('reduces to the familiar ratio', () => {
    expect(describeAspect({ width: 1920, height: 1080 })).toBe('1920×1080 · 16:9');
    expect(describeAspect({ width: 1280, height: 1024 })).toBe('1280×1024 · 5:4');
  });

  it('has a placeholder before the track reports a size', () => {
    expect(describeAspect(null)).toBe('—');
  });
});

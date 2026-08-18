/**
 * Type system. Two faces, mirroring the dashboard's role split:
 *
 *   • mono (Space Mono, bundled) — the Fort Dice signature. Every uppercase
 *     micro-label, status chip, device id, metric readout and eyebrow. The web app
 *     forces weight 700 on uppercase mono labels because Space Mono ships only
 *     400/700 and inheriting 500 silently falls back to a thin 400; we make that
 *     explicit here by exposing the bold face as its own family name.
 *
 *   • sans (platform system face) — body copy, headings, buttons. The dashboard
 *     uses Bricolage Grotesque, a variable font that renders inconsistently on
 *     Android and needs per-weight static instances; San Francisco / Roboto are
 *     the same kind of geometric-humanist grotesque, are hinted for their own
 *     screens, and cost nothing to ship. Swapping in Bricolage later means
 *     changing only `sans` below.
 *
 * `letterSpacing` values are absolute points in React Native (not em), so the
 * tracking used for uppercase mono labels is expressed per size rather than as one
 * shared constant — 0.2em at 10pt is 2pt, at 11pt it is 2.2pt.
 */
import { Platform, TextStyle } from 'react-native';

export const fonts = {
  mono: 'SpaceMono-Regular',
  monoBold: 'SpaceMono-Bold',
  sans: Platform.select({ ios: 'System', android: 'Roboto', default: 'System' }) as string,
};

/** Font weights that actually render on both platforms. */
export const weight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const satisfies Record<string, TextStyle['fontWeight']>;

/**
 * eyebrow builds the uppercase mono micro-label used for section kickers, status
 * text and metadata. `size` drives the tracking so the optical rhythm holds at any
 * scale (the web app's `tracking-[0.2em]` / `tracking-wide` equivalents).
 */
export function eyebrow(size: number, tracking = 0.16): TextStyle {
  return {
    fontFamily: fonts.monoBold,
    fontSize: size,
    letterSpacing: size * tracking,
    textTransform: 'uppercase',
  };
}

/** Mono readout — ids, IPs, resolutions, timers. Not uppercase, so no tracking. */
export function readout(size: number, bold = false): TextStyle {
  return {
    fontFamily: bold ? fonts.monoBold : fonts.mono,
    fontSize: size,
  };
}

export const type = {
  /** Screen title. */
  title: {
    fontFamily: fonts.sans,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: weight.bold,
    letterSpacing: -0.6,
  } satisfies TextStyle,
  /** Card / section heading. */
  heading: {
    fontFamily: fonts.sans,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: weight.semibold,
    letterSpacing: -0.3,
  } satisfies TextStyle,
  /** Primary body copy. */
  body: {
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: weight.medium,
  } satisfies TextStyle,
  /** Secondary body copy / helper text. */
  caption: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: weight.regular,
  } satisfies TextStyle,
  /** Button label. */
  button: {
    fontFamily: fonts.sans,
    fontSize: 15,
    fontWeight: weight.semibold,
    letterSpacing: 0.1,
  } satisfies TextStyle,
};

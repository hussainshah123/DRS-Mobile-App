/**
 * Motion tokens. Every animation in the app pulls its duration and curve from
 * here, so the whole surface moves with one hand — the thing that separates
 * "animated" from "smooth".
 *
 * `standard` is the dashboard's signature curve, cubic-bezier(.2, .7, .2, 1): a
 * fast start that settles late. It is used for entrances, layout changes and the
 * session panel slide, exactly as the web app's `animate-fade-up` /
 * `animate-modal-in` do.
 *
 * IMPORTANT: everything here is designed to run on the native driver. Only
 * `opacity` and `transform` are animated anywhere in this app; nothing animates
 * layout (width/height/margin) on the JS thread, because a dropped frame during a
 * live remote session is the most visible kind of jank there is.
 */
import { Easing, EasingFunction } from 'react-native';

export const duration = {
  /** Press feedback — must feel instantaneous. */
  instant: 110,
  /** Chip/toggle state changes. */
  fast: 180,
  /** Default: entrances, cross-fades, status transitions. */
  base: 280,
  /** Panel slides, modal presentation. */
  slow: 380,
  /** Ambient loops (the live pulse, the connecting sweep). */
  ambient: 1300,
} as const;

export const easing: Record<'standard' | 'out' | 'in' | 'inOut' | 'linear', EasingFunction> = {
  /** cubic-bezier(.2, .7, .2, 1) — the DRS curve. */
  standard: Easing.bezier(0.2, 0.7, 0.2, 1),
  out: Easing.out(Easing.cubic),
  in: Easing.in(Easing.cubic),
  inOut: Easing.inOut(Easing.cubic),
  linear: Easing.linear,
};

/** Shared config for the signature entrance: fade up from 22px, DRS curve. */
export const fadeUp = {
  distance: 22,
  duration: duration.slow,
  easing: easing.standard,
} as const;

/**
 * Spring used for press scale. Low tension + high friction gives a firm, non-bouncy
 * response — a control that overshoots feels toy-like on an operator tool.
 */
export const pressSpring = {
  tension: 320,
  friction: 22,
  useNativeDriver: true,
} as const;

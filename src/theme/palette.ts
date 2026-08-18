/**
 * The Fort Dice palette, ported verbatim from the DRS dashboard's CSS custom
 * properties (drs/src/index.css). The hex values are the SAME numbers the web app
 * ships, so a device card in the app and the same card in the browser are the same
 * colour — that is the whole point of duplicating them here rather than picking
 * "close enough" mobile tones.
 *
 * Dark is the default (the dashboard's `:root`); light is the warm-cream override
 * (`:root[data-theme="light"]`). Light mode deliberately darkens `lime` to an olive
 * and warms `coral`/`amber` so every status label clears WCAG AA on cream — do not
 * "fix" those to match dark, they are intentional divergences documented in the
 * web app's thememode.md.
 */

export type ThemeName = 'dark' | 'light';

export type Palette = {
  /** Page background. */
  ink: string;
  /** Card / panel surface. */
  coal: string;
  /** Hover / inset surface — inputs, chips, pressed states. */
  sand: string;
  /** Primary text. */
  paper: string;
  /** Secondary text and borders. */
  muted: string;
  /** Tertiary text — the dimmest labels. */
  faint: string;
  /** Primary accent. */
  coral: string;
  /** Warm secondary accent / coral hover. */
  ember: string;
  /** Success / active / live. */
  lime: string;
  /** Warning. */
  amber: string;
  /** Hairline border, pre-blended (fixed alpha). */
  hairline: string;
  /** Scrim behind modals and over video overlays. */
  scrim: string;
  /** True black — the remote-desktop viewport letterbox. */
  black: string;
};

/**
 * withAlpha replaces the web's `bg-coal/70` opacity modifiers. React Native has no
 * colour-mix, so tokens are stored as hex and composed here. Alpha is clamped
 * because a computed value (e.g. an animation driving opacity) must never emit an
 * invalid `#RRGGBBAA`.
 */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const byte = Math.round(a * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${byte}`;
}

const dark: Palette = {
  ink: '#0c0a09',
  coal: '#141110',
  sand: '#2a2522',
  paper: '#f3ece1',
  muted: '#a39a8d',
  faint: '#8a8074',
  coral: '#ff5436',
  ember: '#ff8a5b',
  lime: '#c8f54e',
  amber: '#f5a623',
  hairline: 'rgba(243, 236, 225, 0.1)',
  scrim: 'rgba(0, 0, 0, 0.72)',
  black: '#000000',
};

const light: Palette = {
  ink: '#f9f9f9',
  coal: '#ffffff',
  sand: '#f3ebe4',
  paper: '#241914',
  muted: '#6e5d53',
  faint: '#7a675d',
  coral: '#e24e23',
  ember: '#f26a3e',
  // Olive, not neon: #c8f54e only reads on charcoal.
  lime: '#5e7a0c',
  amber: '#b5791a',
  hairline: 'rgba(36, 25, 20, 0.11)',
  scrim: 'rgba(36, 25, 20, 0.55)',
  black: '#000000',
};

export const palettes: Record<ThemeName, Palette> = { dark, light };

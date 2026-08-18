/**
 * Soft keyboard → InputEvent.
 *
 * This is the trickiest translation in the app, and the reason is a real asymmetry in the
 * agent, found by reading its three input backends rather than assuming they match:
 *
 *   • Windows (input_windows.go) and macOS (input_darwin.go) map `code` to a virtual key
 *     when they can, and otherwise INJECT `key` AS UNICODE — a complete down+up on the
 *     key-down event, ignoring the key-up.
 *
 *   • Linux/X11 (input_linux.go) has NO Unicode path. Its comment is explicit: reaching an
 *     arbitrary character would mean temporarily rebinding a spare keycode, which races with
 *     every X client's keymap cache, so an unmapped `code` is DROPPED and logged.
 *
 * A mobile soft keyboard reports characters, not physical keys — the opposite of what a
 * layout-independent `code` describes. If this module sent characters only, typing would
 * work on Windows and macOS and silently do nothing on Linux.
 *
 * So every character is resolved to its US-layout PHYSICAL KEY plus a shift flag, and sent as
 * a proper `code` with the character in `key`. That satisfies all three backends at once:
 * Linux gets a keysym it can look up in the device's own layout, and Windows/macOS get a VK.
 * Characters that exist on no US key (accented letters, emoji, CJK) fall back to
 * character-only injection — which is correct on Windows/macOS and, on Linux, a key the agent
 * will log and drop. That is a real limitation of the existing agent, not something this
 * client can paper over, and it is surfaced in the UI rather than hidden.
 *
 * Shift is emitted as its own key events around the character, because that is how all three
 * backends compose a shifted glyph: Windows and Linux both resolve the shifted level from a
 * held Shift, and macOS stamps its tracked modifier flags onto the event.
 */
import { keyDown, keyUp, type InputEvent } from '../protocol/inputEvent';

/** A physical key plus whether Shift must be held to produce the glyph. */
type PhysicalKey = { code: string; shift: boolean };

/**
 * Unshifted glyph → US-layout code, for everything that is not a letter or digit.
 * Letters and digits are derived arithmetically below rather than listed.
 */
const UNSHIFTED: Record<string, string> = {
  '`': 'Backquote',
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  ' ': 'Space',
};

/** Shifted glyph → the same physical keys, with Shift held. */
const SHIFTED: Record<string, string> = {
  '~': 'Backquote',
  '!': 'Digit1',
  '@': 'Digit2',
  '#': 'Digit3',
  $: 'Digit4',
  '%': 'Digit5',
  '^': 'Digit6',
  '&': 'Digit7',
  '*': 'Digit8',
  '(': 'Digit9',
  ')': 'Digit0',
  _: 'Minus',
  '+': 'Equal',
  '{': 'BracketLeft',
  '}': 'BracketRight',
  '|': 'Backslash',
  ':': 'Semicolon',
  '"': 'Quote',
  '<': 'Comma',
  '>': 'Period',
  '?': 'Slash',
};

/**
 * physicalKeyFor resolves one character to a US-layout physical key, or null when the
 * character lives on no US key.
 */
export function physicalKeyFor(char: string): PhysicalKey | null {
  if (char.length !== 1) {
    return null;
  }
  if (char >= 'a' && char <= 'z') {
    return { code: `Key${char.toUpperCase()}`, shift: false };
  }
  if (char >= 'A' && char <= 'Z') {
    return { code: `Key${char}`, shift: true };
  }
  if (char >= '0' && char <= '9') {
    return { code: `Digit${char}`, shift: false };
  }
  if (UNSHIFTED[char]) {
    return { code: UNSHIFTED[char], shift: false };
  }
  if (SHIFTED[char]) {
    return { code: SHIFTED[char], shift: true };
  }
  return null;
}

/** The modifier codes, left-hand by convention (the agent maps left/right distinctly). */
export const Modifier = {
  SHIFT: 'ShiftLeft',
  CONTROL: 'ControlLeft',
  ALT: 'AltLeft',
  META: 'MetaLeft',
} as const;

export type Modifier = (typeof Modifier)[keyof typeof Modifier];

/**
 * eventsForChar produces the events to type one character.
 *
 * `key` is always populated, even on the code path: it costs nothing, and it is what lets
 * Windows and macOS fall back to Unicode for a character whose code they do not map.
 */
export function eventsForChar(char: string): InputEvent[] {
  const physical = physicalKeyFor(char);

  if (!physical) {
    // Character-only. Windows/macOS inject it as Unicode on the key-down and ignore the
    // key-up, so the up event is sent purely for protocol symmetry. Linux will drop it.
    return [keyDown('', char), keyUp('', char)];
  }

  if (!physical.shift) {
    return [keyDown(physical.code, char), keyUp(physical.code, char)];
  }
  // Shift must be held AROUND the key, not merged into it — all three backends resolve the
  // shifted glyph from the modifier's own key state.
  return [
    keyDown(Modifier.SHIFT, 'Shift'),
    keyDown(physical.code, char),
    keyUp(physical.code, char),
    keyUp(Modifier.SHIFT, 'Shift'),
  ];
}

/**
 * eventsForText types a whole string. Used for the paste action and for the text the soft
 * keyboard commits in one go (autocorrect and predictive input both commit multiple
 * characters at once).
 *
 * Iterating with a for..of walks by CODE POINT, not UTF-16 unit, so an emoji or any
 * astral-plane character is one `key` rather than two broken halves.
 */
export function eventsForText(text: string): InputEvent[] {
  const events: InputEvent[] = [];
  for (const char of text) {
    events.push(...eventsForChar(char));
  }
  return events;
}

/**
 * eventsForNamedKey presses a non-printing key by its code. `label` is what goes in `key`;
 * the agent uses it only for the Unicode fallback, which never applies to these because
 * every code below is in all three backends' tables.
 */
export function eventsForNamedKey(code: string, label = ''): InputEvent[] {
  return [keyDown(code, label), keyUp(code, label)];
}

/**
 * eventsForChord builds a modifier combination — Ctrl+C, Cmd+Tab, Ctrl+Alt+Delete.
 *
 * Modifiers go down in order and come up in REVERSE order. That is not cosmetic: releasing
 * an outer modifier before an inner one leaves the inner one held on the device, and a
 * stranded Ctrl or Alt makes the desktop unusable until someone presses it physically.
 */
export function eventsForChord(modifiers: Modifier[], code: string, label = ''): InputEvent[] {
  const events: InputEvent[] = [];
  for (const modifier of modifiers) {
    events.push(keyDown(modifier, modifierLabel(modifier)));
  }
  events.push(keyDown(code, label));
  events.push(keyUp(code, label));
  for (const modifier of [...modifiers].reverse()) {
    events.push(keyUp(modifier, modifierLabel(modifier)));
  }
  return events;
}

function modifierLabel(modifier: Modifier): string {
  switch (modifier) {
    case Modifier.SHIFT:
      return 'Shift';
    case Modifier.CONTROL:
      return 'Control';
    case Modifier.ALT:
      return 'Alt';
    case Modifier.META:
      return 'Meta';
    default:
      return '';
  }
}

/**
 * releaseAll lifts every modifier.
 *
 * This is the panic button, and it runs whenever control is revoked, the session ends, or the
 * app is backgrounded. Without it, a session that drops while Ctrl is held leaves the remote
 * desktop with a phantom Ctrl down and no way for the app to clear it — the operator would
 * have to walk to the machine.
 */
export function releaseAllModifiers(): InputEvent[] {
  return [Modifier.SHIFT, Modifier.CONTROL, Modifier.ALT, Modifier.META].map(modifier =>
    keyUp(modifier, modifierLabel(modifier)),
  );
}

/** A key on the on-screen special-key bar. */
export type SpecialKey = {
  /** What the operator sees. */
  label: string;
  /** KeyboardEvent.code sent to the agent. */
  code: string;
  /** The `key` value, where a meaningful one exists. */
  keyValue?: string;
  /** Rendered wider in the bar (Tab, Enter, Backspace). */
  wide?: boolean;
};

/**
 * The special-key bar. These are exactly the keys a soft keyboard either cannot produce or
 * produces unreliably, plus the navigation cluster — the set that makes a remote desktop
 * actually operable rather than just typeable.
 */
export const SPECIAL_KEYS: SpecialKey[] = [
  { label: 'Esc', code: 'Escape', keyValue: 'Escape' },
  { label: 'Tab', code: 'Tab', keyValue: 'Tab', wide: true },
  { label: '⌫', code: 'Backspace', keyValue: 'Backspace' },
  { label: '⏎', code: 'Enter', keyValue: 'Enter', wide: true },
  { label: 'Del', code: 'Delete', keyValue: 'Delete' },
  { label: '↑', code: 'ArrowUp', keyValue: 'ArrowUp' },
  { label: '↓', code: 'ArrowDown', keyValue: 'ArrowDown' },
  { label: '←', code: 'ArrowLeft', keyValue: 'ArrowLeft' },
  { label: '→', code: 'ArrowRight', keyValue: 'ArrowRight' },
  { label: 'Home', code: 'Home', keyValue: 'Home' },
  { label: 'End', code: 'End', keyValue: 'End' },
  { label: 'PgUp', code: 'PageUp', keyValue: 'PageUp' },
  { label: 'PgDn', code: 'PageDown', keyValue: 'PageDown' },
];

/** Function keys, on their own row so the bar above stays reachable one-handed. */
export const FUNCTION_KEYS: SpecialKey[] = Array.from({ length: 12 }, (_, i) => ({
  label: `F${i + 1}`,
  code: `F${i + 1}`,
  keyValue: `F${i + 1}`,
}));

/** One-tap chords for the operations a support session needs constantly. */
export type Chord = {
  label: string;
  modifiers: Modifier[];
  code: string;
  keyValue?: string;
  /** Shown as a caption so an operator knows what it does before tapping. */
  hint: string;
};

export const CHORDS: Chord[] = [
  {
    label: 'Ctrl+C',
    modifiers: [Modifier.CONTROL],
    code: 'KeyC',
    keyValue: 'c',
    hint: 'Copy',
  },
  {
    label: 'Ctrl+V',
    modifiers: [Modifier.CONTROL],
    code: 'KeyV',
    keyValue: 'v',
    hint: 'Paste',
  },
  {
    label: 'Ctrl+X',
    modifiers: [Modifier.CONTROL],
    code: 'KeyX',
    keyValue: 'x',
    hint: 'Cut',
  },
  {
    label: 'Ctrl+Z',
    modifiers: [Modifier.CONTROL],
    code: 'KeyZ',
    keyValue: 'z',
    hint: 'Undo',
  },
  {
    label: 'Ctrl+A',
    modifiers: [Modifier.CONTROL],
    code: 'KeyA',
    keyValue: 'a',
    hint: 'Select all',
  },
  {
    label: 'Alt+Tab',
    modifiers: [Modifier.ALT],
    code: 'Tab',
    keyValue: 'Tab',
    hint: 'Switch window',
  },
  {
    label: 'Win',
    modifiers: [],
    code: Modifier.META,
    keyValue: 'Meta',
    hint: 'Start menu',
  },
  {
    label: 'Ctrl+Shift+Esc',
    modifiers: [Modifier.CONTROL, Modifier.SHIFT],
    code: 'Escape',
    keyValue: 'Escape',
    hint: 'Task Manager',
  },
];

/**
 * canTypeOnLinux reports whether a character will survive the X11 backend. Used to warn the
 * operator once, up front, rather than letting characters vanish silently — the agent logs
 * the drop on the DEVICE, where nobody in this app will ever see it.
 */
export function canTypeOnLinux(char: string): boolean {
  return physicalKeyFor(char) !== null;
}

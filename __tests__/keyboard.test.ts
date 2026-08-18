/**
 * Soft keyboard → InputEvent translation.
 *
 * The behaviour under test comes from reading the agent's three input backends, not from the
 * protocol doc, because they disagree in a way that matters:
 *
 *   • input_windows.go / input_darwin.go: map `code` to a virtual key, else inject `key` as Unicode.
 *   • input_linux.go: maps `code` to an X keysym, and DROPS anything unmapped — X11 has no Unicode
 *     injection path at all.
 *
 * So the requirement these tests pin down is that a printable character is sent with a real
 * US-layout `code`, never as character-only. A regression here would type fine on Windows and macOS
 * and silently do nothing on every Linux desktop in the fleet.
 */
import {
  CHORDS,
  FUNCTION_KEYS,
  Modifier,
  SPECIAL_KEYS,
  canTypeOnLinux,
  eventsForChar,
  eventsForChord,
  eventsForNamedKey,
  eventsForText,
  physicalKeyFor,
  releaseAllModifiers,
} from '../src/remote-control/keyboard';

describe('physicalKeyFor', () => {
  it('derives letter keys, with shift for capitals', () => {
    expect(physicalKeyFor('a')).toEqual({ code: 'KeyA', shift: false });
    expect(physicalKeyFor('Z')).toEqual({ code: 'KeyZ', shift: true });
  });

  it('derives digits from the number row, not the numpad', () => {
    // Digit0..9 are what all three backends map; Numpad0..9 are physically different keys and
    // behave differently under NumLock.
    expect(physicalKeyFor('7')).toEqual({ code: 'Digit7', shift: false });
  });

  it('resolves unshifted and shifted punctuation to the same physical key', () => {
    expect(physicalKeyFor('/')).toEqual({ code: 'Slash', shift: false });
    expect(physicalKeyFor('?')).toEqual({ code: 'Slash', shift: true });
    expect(physicalKeyFor(';')).toEqual({ code: 'Semicolon', shift: false });
    expect(physicalKeyFor(':')).toEqual({ code: 'Semicolon', shift: true });
  });

  it('has no physical key for a character absent from a US layout', () => {
    expect(physicalKeyFor('é')).toBeNull();
    expect(physicalKeyFor('中')).toBeNull();
    expect(physicalKeyFor('🙂')).toBeNull();
  });
});

describe('eventsForChar', () => {
  it('sends a real code so the X11 backend can resolve it', () => {
    expect(eventsForChar('a')).toEqual([
      { t: 'kd', code: 'KeyA', key: 'a' },
      { t: 'ku', code: 'KeyA', key: 'a' },
    ]);
  });

  it('wraps a shifted glyph in Shift key events rather than relying on the character', () => {
    // All three backends compose the shifted level from a HELD Shift; sending 'A' with no Shift
    // yields a lowercase 'a' on Linux.
    expect(eventsForChar('A')).toEqual([
      { t: 'kd', code: 'ShiftLeft', key: 'Shift' },
      { t: 'kd', code: 'KeyA', key: 'A' },
      { t: 'ku', code: 'KeyA', key: 'A' },
      { t: 'ku', code: 'ShiftLeft', key: 'Shift' },
    ]);
  });

  it('releases Shift after the key, never before', () => {
    const events = eventsForChar('!');
    const shiftUp = events.findIndex(e => e.t === 'ku' && e.code === 'ShiftLeft');
    const keyUp = events.findIndex(e => e.t === 'ku' && e.code === 'Digit1');
    expect(keyUp).toBeLessThan(shiftUp);
  });

  it('falls back to character-only for a glyph with no US key', () => {
    // Correct on Windows/macOS (Unicode injection); the Linux agent logs and drops it. That is an
    // agent limitation this client cannot fix, so the shape is asserted rather than worked around.
    expect(eventsForChar('é')).toEqual([
      { t: 'kd', code: '', key: 'é' },
      { t: 'ku', code: '', key: 'é' },
    ]);
  });

  it('sends a space as the Space key', () => {
    expect(eventsForChar(' ')[0]).toEqual({ t: 'kd', code: 'Space', key: ' ' });
  });
});

describe('eventsForText', () => {
  it('types a multi-character commit, as predictive input produces', () => {
    const events = eventsForText('Hi');
    // 'H' → shift-wrapped (4 events), 'i' → plain (2 events).
    expect(events).toHaveLength(6);
    expect(events[0]).toEqual({ t: 'kd', code: 'ShiftLeft', key: 'Shift' });
    expect(events[4]).toEqual({ t: 'kd', code: 'KeyI', key: 'i' });
  });

  it('walks by code point so an astral character is one key, not two broken halves', () => {
    const events = eventsForText('🙂');
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ t: 'kd', code: '', key: '🙂' });
  });
});

describe('eventsForChord', () => {
  it('releases modifiers in reverse order so none is stranded', () => {
    const events = eventsForChord([Modifier.CONTROL, Modifier.SHIFT], 'Escape', 'Escape');
    expect(events.map(e => `${e.t}:${'code' in e ? e.code : ''}`)).toEqual([
      'kd:ControlLeft',
      'kd:ShiftLeft',
      'kd:Escape',
      'ku:Escape',
      'ku:ShiftLeft',
      'ku:ControlLeft',
    ]);
  });

  it('builds a plain Ctrl+C', () => {
    expect(eventsForChord([Modifier.CONTROL], 'KeyC', 'c')).toEqual([
      { t: 'kd', code: 'ControlLeft', key: 'Control' },
      { t: 'kd', code: 'KeyC', key: 'c' },
      { t: 'ku', code: 'KeyC', key: 'c' },
      { t: 'ku', code: 'ControlLeft', key: 'Control' },
    ]);
  });
});

describe('releaseAllModifiers', () => {
  it('lifts every modifier — the escape hatch for a stranded key', () => {
    const events = releaseAllModifiers();
    expect(events.every(e => e.t === 'ku')).toBe(true);
    expect(events.map(e => ('code' in e ? e.code : ''))).toEqual([
      'ShiftLeft',
      'ControlLeft',
      'AltLeft',
      'MetaLeft',
    ]);
  });
});

describe('eventsForNamedKey', () => {
  it('emits a down/up pair for a non-printing key', () => {
    expect(eventsForNamedKey('Enter', 'Enter')).toEqual([
      { t: 'kd', code: 'Enter', key: 'Enter' },
      { t: 'ku', code: 'Enter', key: 'Enter' },
    ]);
  });
});

describe('the on-screen key sets', () => {
  /**
   * Every code offered in the UI must exist in the agent's own tables, or the button is a lie. This
   * list is transcribed from agent/internal/input/input_windows.go's vkCodes — the narrowest of the
   * three backends' coverage for these keys.
   */
  const agentKnownCodes = new Set([
    'Enter', 'NumpadEnter', 'Escape', 'Backspace', 'Tab', 'Space', 'Delete', 'Insert',
    'Home', 'End', 'PageUp', 'PageDown',
    'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown',
    'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
    'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock',
    ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  ]);

  it('offers only special keys the agent can inject', () => {
    for (const key of SPECIAL_KEYS) {
      expect(agentKnownCodes.has(key.code)).toBe(true);
    }
  });

  it('offers only function keys the agent can inject', () => {
    for (const key of FUNCTION_KEYS) {
      expect(agentKnownCodes.has(key.code)).toBe(true);
    }
  });

  it('builds every chord from codes the agent can inject', () => {
    for (const chord of CHORDS) {
      const resolvable = agentKnownCodes.has(chord.code) || canTypeOnLinux(chord.keyValue ?? '');
      expect(resolvable).toBe(true);
    }
  });
});

describe('canTypeOnLinux', () => {
  it('reports the X11 backend limitation honestly', () => {
    expect(canTypeOnLinux('a')).toBe(true);
    expect(canTypeOnLinux('?')).toBe(true);
    expect(canTypeOnLinux('é')).toBe(false);
  });
});

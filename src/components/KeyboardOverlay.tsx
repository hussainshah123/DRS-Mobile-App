/**
 * The remote keyboard.
 *
 * Two halves, because a mobile keyboard cannot do what a desktop keyboard does:
 *
 *  1. A hidden TextInput that captures the SOFT KEYBOARD. Every character it commits is
 *     translated to physical key events and sent. This is what makes typing feel native — the
 *     operator gets their own autocorrect, their own language, their own layout.
 *
 *  2. Rows of special keys and chords, because a soft keyboard has no Esc, no F-keys, no arrows
 *     worth using, and no way to express Ctrl+Alt+Delete.
 *
 * THE CAPTURE TRICK. The TextInput's value is forced back to empty on every change, and the
 * DIFFERENCE is what gets typed. That is the only reliable way to read a soft keyboard as a
 * key stream: the platforms disagree about `onKeyPress`, autocorrect rewrites text in place, and
 * predictive input commits whole words at once. Diffing the value handles all three uniformly —
 * a word replacement arrives as a backspace run plus the new text, exactly as a desktop would
 * see it.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleProp, TextInput, View, ViewStyle } from 'react-native';

import type { InputEvent } from '../protocol/inputEvent';
import {
  CHORDS,
  FUNCTION_KEYS,
  Modifier,
  SPECIAL_KEYS,
  eventsForChar,
  eventsForChord,
  eventsForNamedKey,
  eventsForText,
  releaseAllModifiers,
  type SpecialKey,
} from '../remote-control/keyboard';
import { type Theme, useTheme, useThemedStyles, withAlpha } from '../theme';
import { Eyebrow } from './Eyebrow';
import { Pressable } from './Pressable';

export type KeyboardOverlayProps = {
  visible: boolean;
  /** Where events go. Dropped upstream unless control is in force. */
  send: (event: InputEvent) => void;
  onClose: () => void;
  style?: StyleProp<ViewStyle>;
};

export function KeyboardOverlay({ visible, send, onClose, style }: KeyboardOverlayProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  /** Sticky modifiers: held until tapped again, so Ctrl+C is two taps rather than a chord. */
  const [sticky, setSticky] = useState<Set<Modifier>>(new Set());

  const emit = useCallback(
    (events: InputEvent[]) => {
      for (const event of events) {
        send(event);
      }
    },
    [send],
  );

  /**
   * Wraps a key in whatever sticky modifiers are held, then clears them — the standard
   * "press Ctrl, press C, Ctrl releases itself" behaviour of every on-screen keyboard.
   */
  const emitWithModifiers = useCallback(
    (code: string, keyValue: string) => {
      const modifiers = Array.from(sticky);
      if (modifiers.length === 0) {
        emit(eventsForNamedKey(code, keyValue));
        return;
      }
      emit(eventsForChord(modifiers, code, keyValue));
      setSticky(new Set());
    },
    [emit, sticky],
  );

  /**
   * onChangeText is the soft-keyboard reader.
   *
   * The input is held at empty, so `text` IS the newly committed content. A backspace produces an
   * empty change with no text, which is why Backspace is also on the special-key row — the
   * platforms do not reliably report a deletion from an already-empty field.
   */
  const onChangeText = useCallback(
    (text: string) => {
      if (!text) {
        return;
      }
      const modifiers = Array.from(sticky);
      if (modifiers.length > 0 && text.length === 1) {
        // A single character with a modifier held is a chord (Ctrl+C), not typed text.
        const physical = eventsForChar(text);
        // eventsForChar may wrap the char in Shift; for a chord we want the raw key, so rebuild
        // it from the first key-down's code.
        const first = physical.find(e => e.t === 'kd' && e.code) as { code: string } | undefined;
        if (first?.code) {
          emit(eventsForChord(modifiers, first.code, text));
          setSticky(new Set());
          inputRef.current?.clear();
          return;
        }
      }
      emit(eventsForText(text));
      // Clear so the next change is again a pure delta. `clear()` does not fire onChangeText, so
      // this cannot recurse.
      inputRef.current?.clear();
    },
    [emit, sticky],
  );

  const toggleModifier = useCallback((modifier: Modifier) => {
    setSticky(current => {
      const next = new Set(current);
      if (next.has(modifier)) {
        next.delete(modifier);
      } else {
        next.add(modifier);
      }
      return next;
    });
  }, []);

  const panic = useCallback(() => {
    // Release everything, on the device and locally. This is the escape hatch for a stranded
    // modifier — without it a dropped Ctrl leaves the remote desktop unusable.
    emit(releaseAllModifiers());
    setSticky(new Set());
  }, [emit]);

  const modifierRow = useMemo(
    () =>
      [
        { label: 'Ctrl', modifier: Modifier.CONTROL },
        { label: 'Shift', modifier: Modifier.SHIFT },
        { label: 'Alt', modifier: Modifier.ALT },
        { label: 'Meta', modifier: Modifier.META },
      ] as const,
    [],
  );

  if (!visible) {
    return null;
  }

  return (
    <View style={[styles.panel, style]}>
      {/*
        The capture field. Positioned off-screen rather than given zero size or opacity 0:
        Android refuses focus to a zero-size input, and an invisible-but-laid-out input can
        still be tapped by accident. Off-screen keeps it focusable and untouchable.
      */}
      <TextInput
        ref={inputRef}
        value=""
        onChangeText={onChangeText}
        autoFocus
        multiline
        blurOnSubmit={false}
        // Every assistive feature that rewrites text is off: this field is a key pipe, not a text
        // box, and a capitalised first letter or a corrected word would be sent as-typed to
        // someone else's machine.
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        keyboardAppearance={theme.isDark ? 'dark' : 'light'}
        style={styles.capture}
        accessibilityLabel="Remote keyboard input"
      />

      <View style={styles.header}>
        <Eyebrow size={9} color={theme.colors.faint} tracking={0.2}>
          Remote keyboard
        </Eyebrow>
        <View style={styles.headerActions}>
          <Pressable style={styles.textAction} onPress={panic}>
            <Eyebrow size={9} color={theme.colors.amber} tracking={0.16}>
              Release keys
            </Eyebrow>
          </Pressable>
          <Pressable style={styles.textAction} onPress={onClose}>
            <Eyebrow size={9} color={theme.colors.muted} tracking={0.16}>
              Hide
            </Eyebrow>
          </Pressable>
        </View>
      </View>

      {/* Sticky modifiers */}
      <View style={styles.modifierRow}>
        {modifierRow.map(item => {
          const held = sticky.has(item.modifier);
          return (
            <Pressable
              key={item.modifier}
              style={[
                styles.key,
                styles.modifierKey,
                held && {
                  backgroundColor: withAlpha(theme.colors.coral, 0.16),
                  borderColor: withAlpha(theme.colors.coral, 0.45),
                },
              ]}
              onPress={() => toggleModifier(item.modifier)}
              scaleTo={0.92}
              accessibilityRole="button"
              accessibilityState={{ selected: held }}
            >
              <Eyebrow size={10} color={held ? theme.colors.coral : theme.colors.paper} tracking={0.1}>
                {item.label}
              </Eyebrow>
            </Pressable>
          );
        })}
      </View>

      {/* Special keys + function keys */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.keyRow}
        keyboardShouldPersistTaps="always"
      >
        {SPECIAL_KEYS.map(key => (
          <KeyCap key={key.code} item={key} onPress={emitWithModifiers} />
        ))}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.keyRow}
        keyboardShouldPersistTaps="always"
      >
        {FUNCTION_KEYS.map(key => (
          <KeyCap key={key.code} item={key} onPress={emitWithModifiers} />
        ))}
      </ScrollView>

      {/* One-tap chords */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.keyRow}
        keyboardShouldPersistTaps="always"
      >
        {CHORDS.map(chord => (
          <Pressable
            key={chord.label}
            style={[styles.key, styles.chordKey]}
            onPress={() => emit(eventsForChord(chord.modifiers, chord.code, chord.keyValue))}
            scaleTo={0.94}
            accessibilityRole="button"
            accessibilityLabel={`${chord.label}, ${chord.hint}`}
          >
            <Eyebrow size={9} color={theme.colors.paper} tracking={0.08}>
              {chord.label}
            </Eyebrow>
            <Eyebrow size={8} color={theme.colors.faint} tracking={0.1}>
              {chord.hint}
            </Eyebrow>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function KeyCap({
  item,
  onPress,
}: {
  item: SpecialKey;
  onPress: (code: string, keyValue: string) => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      style={[styles.key, item.wide && styles.keyWide]}
      onPress={() => onPress(item.code, item.keyValue ?? '')}
      scaleTo={0.9}
      accessibilityRole="button"
      accessibilityLabel={item.code}
    >
      <Eyebrow size={10} color={theme.colors.paper} tracking={0.06}>
        {item.label}
      </Eyebrow>
    </Pressable>
  );
}

const makeStyles = (theme: Theme) => ({
  panel: {
    backgroundColor: theme.colors.coal,
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
    paddingTop: theme.space.sm,
    gap: theme.space.sm,
  },
  capture: {
    position: 'absolute' as const,
    left: -2000,
    top: 0,
    width: 100,
    height: 40,
    opacity: 0,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: theme.space.lg,
  },
  headerActions: {
    flexDirection: 'row' as const,
    gap: theme.space.lg,
  },
  textAction: {
    paddingVertical: theme.space.xs,
    paddingHorizontal: theme.space.xs,
  },
  modifierRow: {
    flexDirection: 'row' as const,
    paddingHorizontal: theme.space.md,
    gap: theme.space.sm,
  },
  keyRow: {
    flexDirection: 'row' as const,
    paddingHorizontal: theme.space.md,
    gap: theme.space.sm,
  },
  key: {
    minWidth: 46,
    minHeight: 40,
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.sand,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  keyWide: {
    minWidth: 66,
  },
  modifierKey: {
    flex: 1,
  },
  chordKey: {
    minWidth: 82,
    gap: 2,
  },
});

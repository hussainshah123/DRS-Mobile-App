/**
 * The gesture recogniser for the remote desktop viewport.
 *
 * React Native's PanResponder gives raw touch state; this turns it into the DRS gesture
 * vocabulary and pushes the resulting events into the session. It is a hook rather than a
 * component so the viewport stays a plain View and the recogniser can be reasoned about (and
 * changed) without touching layout.
 *
 * The gesture set, and why each one exists:
 *
 *   one finger, tap            → left click
 *   one finger, drag           → move cursor (absolute in touch mode, relative in trackpad)
 *   one finger, long-press     → right click
 *   one finger, hold then drag → press-and-drag (window moves, text selection, sliders)
 *   two fingers, drag          → scroll wheel
 *   two fingers, tap           → right click (the desktop convention, kept for muscle memory)
 *
 * The hard part is that a two-finger gesture begins as a one-finger gesture: the second touch
 * lands a frame or two later. So a one-finger drag that becomes two fingers must RETRACT into
 * a scroll — and must not leave a mouse button pressed on the way. `activeTouches` tracking
 * plus the explicit release in `switchToScroll` is that retraction.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { PanResponder, type GestureResponderEvent, type PanResponderGestureState } from 'react-native';

import type { InputEvent } from '../protocol/inputEvent';
import type { Size } from '../utils/coordinates';
import { LONG_PRESS_MS, PointerMapper, type PointerMode } from './inputMapper';

export type TouchControlOptions = {
  /** The viewport's measured size. */
  container: Size;
  /** The remote picture's pixel size. null until the track reports it. */
  video: Size | null;
  mode: PointerMode;
  /** Cursor speed multiplier for trackpad mode. */
  sensitivity: number;
  /** False in view-only mode: gestures are recognised but nothing is sent. */
  enabled: boolean;
  /** Where events go. */
  send: (event: InputEvent) => void;
  /**
   * Called when a long-press fires, so the UI can show that a right click happened. Sound is
   * the app's feedback channel, so this is where the cue is triggered — not inside the mapper,
   * which stays pure.
   */
  onLongPress?: () => void;
  /** Called when a tap resolves to a click, for the same reason. */
  onTap?: () => void;
  /**
   * Reports the virtual cursor after every move, so the viewport can draw it.
   *
   * It fires even when `enabled` is false and even when an event is coalesced away, because the
   * ON-SCREEN cursor must track the finger at display rate while the WIRE rate stays capped —
   * a cursor that only moves when a packet is sent looks like it is stuttering.
   */
  onCursorMove?: (point: { x: number; y: number }) => void;
};

export function useTouchControl(options: TouchControlOptions) {
  const { container, video, mode, sensitivity, enabled, send, onLongPress, onTap, onCursorMove } =
    options;

  // The mapper holds gesture state across the responder callbacks, so it must survive
  // re-renders — a new mapper mid-drag would lose the cursor and the held button.
  const mapperRef = useRef<PointerMapper | null>(null);
  if (!mapperRef.current) {
    mapperRef.current = new PointerMapper({ container, video }, mode, sensitivity);
  }

  // Geometry and settings are pushed into the existing mapper rather than rebuilding it, so a
  // rotation or a resolution change mid-drag is picked up without dropping the gesture.
  useEffect(() => {
    mapperRef.current?.setGeometry({ container, video });
  }, [container, video]);

  useEffect(() => {
    mapperRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    mapperRef.current?.setSensitivity(sensitivity);
  }, [sensitivity]);

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTouches = useRef(0);
  /** Set once a gesture has been reclassified as a scroll, so it cannot revert. */
  const isScrolling = useRef(false);
  /** Cumulative two-finger translation at the last scroll emission. */
  const lastScroll = useRef({ dx: 0, dy: 0 });
  /** True while a long-press has escalated the gesture into a press-and-drag. */
  const dragging = useRef(false);

  /**
   * emit transmits the events and reports the cursor.
   *
   * The cursor report is OUTSIDE the `enabled` gate on purpose: the overlay should track the
   * finger even in view-only mode, so an operator can line up a target before requesting
   * control — and so requesting control does not make the cursor jump.
   */
  const emit = useCallback(
    (events: InputEvent[]) => {
      if (events.length > 0 && onCursorMove) {
        onCursorMove(mapperRef.current?.getCursor() ?? { x: 0.5, y: 0.5 });
      }
      if (!enabled) {
        return;
      }
      for (const event of events) {
        send(event);
      }
    },
    [enabled, onCursorMove, send],
  );

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  /**
   * switchToScroll retracts a one-finger gesture into a two-finger scroll. Any pressed button
   * is released first: a second finger landing mid-drag must not leave the desktop in a
   * selection or with a window stuck to the cursor.
   */
  const switchToScroll = useCallback(() => {
    clearLongPress();
    if (dragging.current) {
      emit(mapperRef.current?.endDrag() ?? []);
      dragging.current = false;
    }
    isScrolling.current = true;
    lastScroll.current = { dx: 0, dy: 0 };
  }, [clearLongPress, emit]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claim the gesture on touch-down so no parent scroll view can steal a drag that
        // starts slowly — which is exactly what a careful cursor movement looks like.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Do not let an ancestor take the gesture away mid-drag; that would strand a held
        // button with no release.
        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: (event: GestureResponderEvent) => {
          const touches = event.nativeEvent.touches?.length ?? 1;
          activeTouches.current = touches;
          isScrolling.current = touches >= 2;
          lastScroll.current = { dx: 0, dy: 0 };
          dragging.current = false;

          if (isScrolling.current) {
            return;
          }

          const { locationX, locationY, timestamp } = event.nativeEvent;
          emit(
            mapperRef.current?.onTouchStart({
              x: locationX,
              y: locationY,
              timestamp: timestamp ?? Date.now(),
            }) ?? [],
          );

          // Long press → right click, unless the finger has already started travelling, in
          // which case this is a drag and a context menu would be wrong.
          clearLongPress();
          longPressTimer.current = setTimeout(() => {
            longPressTimer.current = null;
            if (isScrolling.current || mapperRef.current?.isDragging) {
              return;
            }
            emit(mapperRef.current?.rightClick() ?? []);
            onLongPress?.();
          }, LONG_PRESS_MS);
        },

        onPanResponderMove: (event: GestureResponderEvent, gesture: PanResponderGestureState) => {
          const touches = event.nativeEvent.touches?.length ?? 1;
          if (touches >= 2 && !isScrolling.current) {
            switchToScroll();
          }
          activeTouches.current = touches;

          if (isScrolling.current) {
            // Emit the increment since the last emission, not the cumulative translation —
            // PanResponder reports the latter, and using it directly would accelerate the
            // scroll quadratically.
            const dx = gesture.dx - lastScroll.current.dx;
            const dy = gesture.dy - lastScroll.current.dy;
            const events = mapperRef.current?.scroll(dx, dy) ?? [];
            if (events.length > 0) {
              lastScroll.current = { dx: gesture.dx, dy: gesture.dy };
              emit(events);
            }
            return;
          }

          const { locationX, locationY, timestamp } = event.nativeEvent;
          emit(
            mapperRef.current?.onTouchMove({
              x: locationX,
              y: locationY,
              dx: gesture.dx,
              dy: gesture.dy,
              timestamp: timestamp ?? Date.now(),
            }) ?? [],
          );

          // Once the finger is clearly travelling, a pending long-press is not a long-press.
          if (mapperRef.current?.isDragging) {
            clearLongPress();
          }
        },

        onPanResponderRelease: (event: GestureResponderEvent) => {
          clearLongPress();
          activeTouches.current = 0;

          if (isScrolling.current) {
            isScrolling.current = false;
            lastScroll.current = { dx: 0, dy: 0 };
            return;
          }

          const mapper = mapperRef.current;
          const wasDragging = mapper?.isDragging ?? false;
          const events = mapper?.onTouchEnd(event.nativeEvent.timestamp ?? Date.now()) ?? [];
          dragging.current = false;
          emit(events);

          // A click resolved (the mapper emitted a down/up pair rather than just a release).
          if (!wasDragging && events.length >= 2) {
            onTap?.();
          }
        },

        onPanResponderTerminate: () => {
          // The OS took the gesture — an incoming call, a system gesture, a notification.
          // Release everything: this is the most common way a button gets stranded.
          clearLongPress();
          activeTouches.current = 0;
          isScrolling.current = false;
          dragging.current = false;
          emit(mapperRef.current?.onTouchCancel() ?? []);
        },
      }),
    [clearLongPress, emit, onLongPress, onTap, switchToScroll],
  );

  // Releasing control, ending the session or unmounting must never leave a button down on
  // someone else's machine.
  useEffect(
    () => () => {
      clearLongPress();
      const events = mapperRef.current?.onTouchCancel() ?? [];
      for (const event of events) {
        send(event);
      }
    },
    [clearLongPress, send],
  );

  /** Explicit actions the toolbar drives, sharing the mapper's cursor. */
  const actions = useMemo(
    () => ({
      doubleClick: () => emit(mapperRef.current?.doubleClick() ?? []),
      rightClick: () => emit(mapperRef.current?.rightClick() ?? []),
      /** Toggle a held left button, for a drag that needs both hands free. */
      toggleDrag: () => {
        const mapper = mapperRef.current;
        if (!mapper) {
          return false;
        }
        if (mapper.isButtonHeld) {
          emit(mapper.endDrag());
          return false;
        }
        emit(mapper.beginDrag());
        return true;
      },
      cursor: () => mapperRef.current?.getCursor() ?? { x: 0.5, y: 0.5 },
      isButtonHeld: () => mapperRef.current?.isButtonHeld ?? false,
    }),
    [emit],
  );

  return { panHandlers: responder.panHandlers, actions };
}

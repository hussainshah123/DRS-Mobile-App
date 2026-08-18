/**
 * The remote desktop viewport — the surface the operator actually touches.
 *
 * It renders whichever transport the agent negotiated (WebRTC video, or JPEG frames in the
 * fallback), owns the gesture recogniser, and is the component that MEASURES ITSELF — which is
 * the crux of the whole input path.
 *
 * Why measurement lives here: coordinate mapping needs the container size and the picture's own
 * pixel size, in the same coordinate space as the touch. `onLayout` gives the first; RTCView's
 * `onDimensionsChange` (or the JPEG frame's own width/height) gives the second. Anything derived
 * further up the tree would be a stale copy after a rotation, and a stale container size makes
 * every tap land in the wrong place — the exact bug spec §11 warns about.
 *
 * `objectFit: 'contain'` is not negotiable here: 'cover' would crop the desktop, and cropped
 * pixels are unreachable ones. The letterbox bars are the price of being able to touch every
 * corner of the screen.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { RTCView, type MediaStream } from 'react-native-webrtc';

import { useTouchControl } from '../remote-control/touch';
import type { PointerMode } from '../remote-control/inputMapper';
import type { InputEvent } from '../protocol/inputEvent';
import type { JpegFrame } from '../session/SessionController';
import { type Theme, useTheme, useThemedStyles, withAlpha } from '../theme';
import { type } from '../theme/typography';
import { ControlState, SessionState, hasPicture, isBusy, isRetryable, type SessionSnapshot } from '../types/session';
import { fittedRect, type Size } from '../utils/coordinates';
import { streamUrl } from '../webrtc/media';
import { Button } from './Button';
import { busyLabel } from './ConnectionStatus';
import { Eyebrow, Readout } from './Eyebrow';
import { IconAlert, IconCursor } from './Icons';

export type RemoteDesktopViewProps = {
  snapshot: SessionSnapshot;
  stream: MediaStream | null;
  frame: JpegFrame | null;
  deviceName: string;
  pointerMode: PointerMode;
  sensitivity: number;
  /** Where input events go. */
  sendInput: (event: InputEvent) => void;
  /** Report the picture's pixel size up to the controller. */
  onVideoSize: (width: number, height: number) => void;
  onRetry: () => void;
  /** Feedback hooks so the sound cues fire from one place. */
  onTap?: () => void;
  onLongPress?: () => void;
  /**
   * Populated with the gesture recogniser's imperative actions.
   *
   * The toolbar's mouse buttons (double-click, hold-drag, right-click) have no gesture context of
   * their own, so they must act at the CURSOR the recogniser is tracking. Handing the actions up
   * through a ref is what lets them share one cursor — the alternative, having the toolbar guess a
   * coordinate, is how a double-click ends up landing in the middle of the screen instead of on
   * the thing the operator was pointing at.
   */
  actionsRef?: React.MutableRefObject<RemoteDesktopActions | null>;
};

/** The imperative actions the toolbar drives, all operating at the tracked cursor. */
export type RemoteDesktopActions = {
  doubleClick: () => void;
  rightClick: () => void;
  /** Toggles a held left button; returns whether it is now held. */
  toggleDrag: () => boolean;
  isButtonHeld: () => boolean;
};

export function RemoteDesktopView({
  snapshot,
  stream,
  frame,
  deviceName,
  pointerMode,
  sensitivity,
  sendInput,
  onVideoSize,
  onRetry,
  onTap,
  onLongPress,
  actionsRef,
}: RemoteDesktopViewProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [container, setContainer] = useState<Size>({ width: 0, height: 0 });

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setContainer({ width, height });
  }, []);

  const onDimensionsChange = useCallback(
    (event: { nativeEvent: { width: number; height: number } }) => {
      const { width, height } = event.nativeEvent;
      onVideoSize(width, height);
    },
    [onVideoSize],
  );

  // Control is live only when the backend granted it AND the channel is open. Gestures are
  // always recognised — so the cursor overlay can preview where a tap would land in view-only
  // mode — but `enabled` decides whether anything is transmitted.
  const controlActive =
    snapshot.control === ControlState.ENABLED && snapshot.state === SessionState.CONTROLLING;

  /**
   * The on-screen cursor position, in container points.
   *
   * An Animated.ValueXY driven by `setValue` rather than React state: the cursor updates at
   * gesture rate (every touch frame), and routing that through a re-render would re-run the
   * whole viewport — including the RTCView — dozens of times a second during a drag. This way
   * only the native transform of one small layer changes.
   */
  const cursor = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  /** Kept in a ref so the gesture callback reads the current rect without re-creating itself. */
  const rectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const onCursorMove = useCallback(
    (point: { x: number; y: number }) => {
      const rect = rectRef.current;
      if (!rect) {
        return;
      }
      // Normalized → container points, using the same fitted rectangle the input path uses, so
      // the ring is drawn exactly where the click will land.
      cursor.setValue({
        x: rect.x + point.x * rect.width,
        y: rect.y + point.y * rect.height,
      });
    },
    [cursor],
  );

  const { panHandlers, actions } = useTouchControl({
    container,
    video: snapshot.videoSize,
    mode: pointerMode,
    sensitivity,
    enabled: controlActive,
    send: sendInput,
    onTap,
    onLongPress,
    onCursorMove,
  });

  // Publish the recogniser's actions upward so the toolbar acts at THIS cursor. Cleared on
  // unmount so a stale closure over a dead gesture state can never be invoked.
  useEffect(() => {
    if (!actionsRef) {
      return undefined;
    }
    actionsRef.current = {
      doubleClick: actions.doubleClick,
      rightClick: actions.rightClick,
      toggleDrag: actions.toggleDrag,
      isButtonHeld: actions.isButtonHeld,
    };
    return () => {
      actionsRef.current = null;
    };
  }, [actions, actionsRef]);

  /**
   * The letterboxed picture rectangle. Used to draw the trackpad cursor and the control
   * boundary exactly where the picture is, rather than over the whole container — showing a
   * cursor on the black bar would imply it is a place you can click.
   */
  const rect = useMemo(() => {
    const next = snapshot.videoSize ? fittedRect(container, snapshot.videoSize) : null;
    rectRef.current = next;
    // Re-centre the cursor whenever the geometry changes (rotation, resolution change): keeping
    // the old pixel position would leave the ring pointing at a different part of the desktop
    // than the mapper's normalized cursor.
    if (next) {
      cursor.setValue({ x: next.x + next.width / 2, y: next.y + next.height / 2 });
    }
    return next;
  }, [container, cursor, snapshot.videoSize]);

  const picture = hasPicture(snapshot.state);
  const showSpinner = isBusy(snapshot.state);
  const failed = snapshot.state === SessionState.ERROR;
  const url = streamUrl(stream);

  return (
    <View style={styles.viewport} onLayout={onLayout} {...panHandlers}>
      {/* WebRTC video. Always mounted so the native renderer is ready the instant a track
          arrives, and hidden rather than unmounted so remounting cannot drop the first frames. */}
      {url ? (
        <RTCView
          streamURL={url}
          objectFit="contain"
          zOrder={0}
          onDimensionsChange={onDimensionsChange}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      {/* JPEG fallback (spec §14). resizeMode 'contain' matches the WebRTC path exactly, so the
          same coordinate mapping applies to both transports without a special case. */}
      {!url && frame ? (
        <Image
          source={{ uri: frame.uri }}
          resizeMode="contain"
          style={StyleSheet.absoluteFill}
          accessibilityLabel={`Live screen of ${deviceName}`}
        />
      ) : null}

      {/* Control boundary: a hairline around the live picture while controlling, so the operator
          can see precisely which pixels are the desktop and which are the bezel. */}
      {controlActive && rect ? (
        <View
          pointerEvents="none"
          style={[
            styles.pictureOutline,
            { left: rect.x, top: rect.y, width: rect.width, height: rect.height },
          ]}
        />
      ) : null}

      {/* Trackpad cursor. Only in trackpad mode: in direct mode the finger IS the cursor and a
          second marker under it is noise. Shown in view-only too, so a target can be lined up
          before control is requested. */}
      {pointerMode === 'trackpad' && rect ? (
        <TrackpadCursor position={cursor} active={controlActive} />
      ) : null}

      {!picture && !failed ? (
        <View style={styles.overlay} pointerEvents="none">
          {showSpinner ? (
            <>
              <ActivityIndicator size="large" color={theme.colors.lime} />
              <Text style={styles.overlayText}>{busyLabel(snapshot.state, deviceName)}</Text>
            </>
          ) : (
            <>
              <IconCursor size={28} color={withAlpha(theme.colors.muted, 0.5)} />
              <Text style={styles.overlayText}>No stream</Text>
            </>
          )}
        </View>
      ) : null}

      {failed ? (
        <View style={styles.overlay}>
          <IconAlert size={30} color={theme.colors.coral} />
          <Eyebrow size={10} color={theme.colors.coral} tracking={0.22}>
            Session unavailable
          </Eyebrow>
          <Text style={styles.errorText}>{snapshot.message}</Text>
          {isRetryable(snapshot.failure) ? (
            <Button label="Reconnect" intent="secondary" onPress={onRetry} style={styles.retry} />
          ) : null}
        </View>
      ) : null}

      {/* Live watermark. Says, at all times, whether input is reaching the device. */}
      {picture ? (
        <View
          pointerEvents="none"
          style={[
            styles.watermark,
            {
              borderColor: withAlpha(controlActive ? theme.colors.coral : theme.colors.lime, 0.4),
              backgroundColor: withAlpha(theme.colors.black, 0.45),
            },
          ]}
        >
          <View
            style={[
              styles.watermarkDot,
              { backgroundColor: controlActive ? theme.colors.coral : theme.colors.lime },
            ]}
          />
          <Readout size={9} color={controlActive ? theme.colors.coral : theme.colors.lime}>
            {controlActive
              ? snapshot.lockLocal
                ? 'CONTROL · LOCAL LOCKED'
                : 'CONTROL'
              : 'VIEW ONLY'}
          </Readout>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The virtual cursor for trackpad mode.
 *
 * It is a ring with a centre dot rather than an arrow: an arrow implies pixel-exact placement,
 * which a relative gesture does not have, whereas a ring reads as "the click lands at this
 * point, inside this area". The position comes from the same normalized→rect maths the input
 * path uses, so what the operator sees and what the agent receives cannot diverge.
 *
 * Positioned by native `translate`, not by `left`/`top` — those are layout properties and would
 * force a layout pass on every touch frame.
 */
function TrackpadCursor({
  position,
  active,
}: {
  position: Animated.ValueXY;
  active: boolean;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const size = 26;
  const color = active ? theme.colors.coral : theme.colors.muted;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        ...styles.cursorRing,
        width: size,
        height: size,
        borderRadius: size / 2,
        borderColor: withAlpha(color, active ? 0.95 : 0.6),
        backgroundColor: withAlpha(color, active ? 0.14 : 0.08),
        transform: [
          // Offset by half the ring so the CENTRE, not the corner, sits on the cursor point.
          { translateX: Animated.subtract(position.x, size / 2) },
          { translateY: Animated.subtract(position.y, size / 2) },
        ],
      }}
    >
      <View style={[styles.cursorDot, { backgroundColor: color }]} />
    </Animated.View>
  );
}

const makeStyles = (theme: Theme) => ({
  viewport: {
    flex: 1,
    // True black, not `ink`: the letterbox should disappear into the bezel rather than read as
    // a panel with the picture inside it.
    backgroundColor: theme.colors.black,
    overflow: 'hidden' as const,
  },
  pictureOutline: {
    position: 'absolute' as const,
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.coral, 0.35),
  },
  overlay: {
    // Written out rather than StyleSheet.absoluteFillObject, which RN 0.87's generated types no
    // longer export (only the registered `absoluteFill` id remains, and that cannot be spread).
    position: 'absolute' as const,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: theme.space.md,
    paddingHorizontal: theme.space.xxl,
  },
  overlayText: {
    ...type.caption,
    color: theme.colors.muted,
    textAlign: 'center' as const,
  },
  errorText: {
    ...type.body,
    color: theme.colors.paper,
    textAlign: 'center' as const,
  },
  retry: {
    marginTop: theme.space.sm,
  },
  watermark: {
    position: 'absolute' as const,
    left: theme.space.md,
    top: theme.space.md,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: theme.space.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  watermarkDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  cursorRing: {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    borderWidth: 1.5,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  cursorDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
});

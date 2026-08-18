/**
 * The live session.
 *
 * Layout in priority order, because on a phone there is no room for anything decorative:
 *
 *   header    device name + session/control state + elapsed. The audit-visible line.
 *   viewport  the remote desktop. Everything else gives it space.
 *   toolbar   View · Control · pointer mode · mouse actions · Keyboard · Lock · Stop.
 *   keyboard  slides up over the toolbar only when asked for.
 *
 * ORIENTATION. The screen does not force landscape — locking it would need another native module,
 * and a hard lock fights an operator who has their device in a dock or a stand. Instead the layout
 * works in both orientations and, when the desktop is wider than the viewport is, a hint offers the
 * reason to rotate: a 16:9 desktop in a portrait viewport is a band roughly a fifth of the screen,
 * which is a technically working session that is practically untouchable.
 *
 * `withControl` carries the intent from the details screen: it requests the input_control grant
 * as soon as the transport can carry it. Requesting it any earlier would send the grant before
 * the data channel existed, and the operator would see "control enabled" while nothing worked.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  BackHandler,
  StatusBar,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectionStatus } from '../components/ConnectionStatus';
import { Eyebrow, Readout } from '../components/Eyebrow';
import { IconChevronLeft, IconShield } from '../components/Icons';
import { KeyboardOverlay } from '../components/KeyboardOverlay';
import { Pressable } from '../components/Pressable';
import { RemoteDesktopView, type RemoteDesktopActions } from '../components/RemoteDesktopView';
import { SessionToolbar } from '../components/SessionToolbar';
import type { PointerMode } from '../remote-control/inputMapper';
import { releaseAllModifiers } from '../remote-control/keyboard';
import { useSession } from '../session/useSession';
import { useAuth } from '../state/AuthContext';
import { duration, easing, type Theme, useTheme, useThemedStyles, withAlpha } from '../theme';
import { type } from '../theme/typography';
import { SessionMode } from '../protocol/envelope';
import { deviceTitle, type Device } from '../types/device';
import { ControlState, SessionState, hasPicture } from '../types/session';
import { describeAspect } from '../utils/coordinates';
import { play } from '../utils/sound';

export type RemoteSessionScreenProps = {
  device: Device;
  /** Request the control grant as soon as the stream is live. */
  withControl: boolean;
  onExit: () => void;
};

/** m:ss, matching the dashboard's session timer. */
function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export function RemoteSessionScreen({ device, withControl, onExit }: RemoteSessionScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const { snapshot, stream, frame, requestControl, sendInput, setVideoSize, retry, stop } =
    useSession(device.id, token);

  const [pointerMode, setPointerMode] = useState<PointerMode>('touch');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [dragHeld, setDragHeld] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);

  /** Set once the initial control request has been honoured, so it fires exactly once. */
  const autoControlDone = useRef(false);
  /**
   * The viewport's gesture actions. The toolbar's mouse buttons act through these so they land at
   * the cursor the recogniser is tracking, rather than at a coordinate this screen would have to
   * invent — a double-click at a guessed centre-screen point is worse than no button at all.
   */
  const desktopActions = useRef<RemoteDesktopActions | null>(null);

  const controlLive =
    snapshot.control === ControlState.ENABLED && snapshot.state === SessionState.CONTROLLING;
  const live = hasPicture(snapshot.state);

  // Honour the "Start control" intent the moment the stream is live — not before, or the grant
  // would arrive with no channel to carry the events.
  useEffect(() => {
    if (!withControl || autoControlDone.current) {
      return;
    }
    if (live && snapshot.control === ControlState.VIEW_ONLY) {
      autoControlDone.current = true;
      requestControl(true, false);
    }
    // A JPEG fallback session can never carry control; stop trying rather than looping.
    if (snapshot.control === ControlState.UNAVAILABLE) {
      autoControlDone.current = true;
    }
  }, [live, requestControl, snapshot.control, withControl]);

  /**
   * Releasing control must also release every modifier.
   *
   * Without this, ending control while Ctrl is held (via the sticky modifier row, or a chord
   * interrupted by a dropped channel) strands it on the remote desktop — and once control is
   * revoked the app can no longer send the key-up that would clear it. So the release goes out
   * FIRST, while the channel is still armed.
   */
  const releaseControl = useCallback(() => {
    if (controlLive) {
      releaseAllModifiers().forEach(sendInput);
      // Same reasoning for a held mouse button: drop it at the tracked cursor before the grant
      // goes away, so the release lands where the press did.
      if (desktopActions.current?.isButtonHeld()) {
        desktopActions.current.toggleDrag();
      }
      setDragHeld(false);
    }
    setKeyboardOpen(false);
    requestControl(false, false);
  }, [controlLive, requestControl, sendInput]);

  const onRequestControl = useCallback(() => {
    if (snapshot.control === ControlState.ENABLED || snapshot.control === ControlState.REQUESTED) {
      releaseControl();
      return;
    }
    play('tap');
    requestControl(true, snapshot.lockLocal);
  }, [releaseControl, requestControl, snapshot.control, snapshot.lockLocal]);

  const onToggleLockLocal = useCallback(() => {
    if (!controlLive) {
      return;
    }
    // Re-issuing input_control with the new lockLocal flag is the whole mechanism: the backend
    // audits the change again and forwards it, and the agent applies or lifts the OS-level lock.
    requestControl(true, !snapshot.lockLocal);
  }, [controlLive, requestControl, snapshot.lockLocal]);

  const onStop = useCallback(() => {
    // A modal confirm, because Stop is irreversible from here and the button sits next to the
    // controls an operator taps constantly.
    Alert.alert(
      'End this session?',
      `${deviceTitle(device)} will stop sharing its screen and the session end will be recorded in the audit log.`,
      [
        { text: 'Keep connected', style: 'cancel' },
        {
          text: 'End session',
          style: 'destructive',
          onPress: () => {
            releaseControl();
            stop();
            onExit();
          },
        },
      ],
    );
  }, [device, onExit, releaseControl, stop]);

  // Android hardware back: release control and end the session rather than leaving it running
  // behind the device list.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onStop();
      return true;
    });
    return () => subscription.remove();
  }, [onStop]);

  // A terminal auth failure is not retryable — the token is dead or the role is wrong — so the
  // only sensible action is to leave. Say why, then go.
  useEffect(() => {
    if (snapshot.state === SessionState.ERROR && snapshot.failure === 'auth') {
      Alert.alert('Not authorized', snapshot.message, [{ text: 'Back to devices', onPress: onExit }]);
    }
  }, [onExit, snapshot.failure, snapshot.message, snapshot.state]);

  /** Chrome auto-hides during a controlled session so the picture gets the whole screen. */
  const chromeOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const animation = Animated.timing(chromeOpacity, {
      toValue: chromeVisible ? 1 : 0,
      duration: duration.base,
      easing: easing.standard,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [chromeOpacity, chromeVisible]);

  const onDoubleClick = useCallback(() => {
    if (!controlLive) {
      return;
    }
    play('tap');
    desktopActions.current?.doubleClick();
  }, [controlLive]);

  /**
   * Hold/release the left button at the tracked cursor, for a drag that needs both hands free
   * (dragging a window across a 4K desktop takes more travel than one swipe).
   */
  const onToggleDrag = useCallback(() => {
    if (!controlLive) {
      return;
    }
    const held = desktopActions.current?.toggleDrag() ?? false;
    setDragHeld(held);
    play(held ? 'controlOn' : 'controlOff');
  }, [controlLive]);

  /**
   * Whether rotating would materially help.
   *
   * Computed from the ACTUAL aspect ratios rather than assuming "portrait is bad": a 4:3 desktop on
   * a tablet in portrait is perfectly usable, and nagging there would be noise. The hint appears
   * only when the desktop is meaningfully wider than the viewport, which is exactly when contain-
   * fitting is throwing away most of the screen.
   */
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const shouldRotate = (() => {
    if (!snapshot.videoSize || !live) {
      return false;
    }
    const desktopAspect = snapshot.videoSize.width / snapshot.videoSize.height;
    const viewportAspect = windowWidth / windowHeight;
    // 1.5× is the point where the letterbox bars take more room than the picture.
    return desktopAspect > viewportAspect * 1.5;
  })();

  const transportLabel =
    snapshot.mode === SessionMode.WEBRTC
      ? 'WebRTC · VP8'
      : snapshot.mode === SessionMode.JPEG
        ? 'JPEG fallback'
        : '—';

  return (
    <View style={styles.root}>
      <StatusBar hidden={!chromeVisible} barStyle="light-content" />

      {/* Header — the audit-visible line. Always says which device and whether control is live. */}
      <Animated.View
        style={[
          styles.header,
          { paddingTop: insets.top + theme.space.sm, opacity: chromeOpacity },
        ]}
        pointerEvents={chromeVisible ? 'auto' : 'none'}
      >
        <Pressable
          style={styles.back}
          onPress={onStop}
          accessibilityRole="button"
          accessibilityLabel="End session and go back"
        >
          <IconChevronLeft size={18} color={theme.colors.paper} />
        </Pressable>

        <View style={styles.headerText}>
          <Text style={styles.deviceName} numberOfLines={1}>
            {deviceTitle(device)}
          </Text>
          <View style={styles.headerMeta}>
            <Readout size={9} color={theme.colors.faint}>
              {transportLabel}
            </Readout>
            <View style={styles.dot} />
            <Readout size={9} color={theme.colors.faint}>
              {describeAspect(snapshot.videoSize)}
            </Readout>
            {live ? (
              <>
                <View style={styles.dot} />
                <Readout size={9} color={theme.colors.faint}>
                  {formatElapsed(snapshot.elapsedSeconds)}
                </Readout>
              </>
            ) : null}
          </View>
        </View>

        <ConnectionStatus
          state={snapshot.state}
          control={snapshot.control}
          lockLocal={snapshot.lockLocal}
          compact
        />
      </Animated.View>

      {/* The remote desktop. Tapping the chrome toggle expands it to the full screen. */}
      <View style={styles.viewportWrap}>
        <RemoteDesktopView
          snapshot={snapshot}
          stream={stream}
          frame={frame}
          deviceName={deviceTitle(device)}
          pointerMode={pointerMode}
          sensitivity={2}
          sendInput={sendInput}
          onVideoSize={setVideoSize}
          onRetry={retry}
          onTap={() => play('tap')}
          onLongPress={() => play('controlOn')}
          actionsRef={desktopActions}
        />

        {/* Chrome toggle. Deliberately small and in a corner the desktop rarely needs, so it
            cannot be hit while working. */}
        <Pressable
          style={[styles.chromeToggle, { top: insets.top + theme.space.sm }]}
          onPress={() => setChromeVisible(v => !v)}
          accessibilityRole="button"
          accessibilityLabel={chromeVisible ? 'Hide session controls' : 'Show session controls'}
        >
          <Eyebrow size={8} color={theme.colors.paper} tracking={0.18}>
            {chromeVisible ? 'Full' : 'Show'}
          </Eyebrow>
        </Pressable>

        {/* Rotate hint. Dismissible by rotating — no button, because a button to dismiss advice
            about rotating is more friction than the advice is worth. */}
        {shouldRotate && chromeVisible ? (
          <View style={styles.rotateHint} pointerEvents="none">
            <Eyebrow size={8} color={theme.colors.amber} tracking={0.16} numberOfLines={1}>
              Rotate for a larger picture
            </Eyebrow>
          </View>
        ) : null}

        {/*
          Control banner. While control is live this sits over the picture as an unmissable
          reminder that input is reaching someone's machine — the mobile equivalent of the
          dashboard's live watermark, and part of the spec's requirement that control never be
          hidden (§13).
        */}
        {controlLive && chromeVisible ? (
          <View style={[styles.controlBanner, { bottom: theme.space.md }]} pointerEvents="none">
            <IconShield size={12} color={theme.colors.coral} />
            <Eyebrow size={8} color={theme.colors.coral} tracking={0.16} numberOfLines={1}>
              {snapshot.lockLocal
                ? 'You are controlling this device · local input locked'
                : 'You are controlling this device'}
            </Eyebrow>
          </View>
        ) : null}
      </View>

      <Animated.View style={{ opacity: chromeOpacity }} pointerEvents={chromeVisible ? 'auto' : 'none'}>
        <SessionToolbar
          state={snapshot.state}
          control={snapshot.control}
          lockLocal={snapshot.lockLocal}
          pointerMode={pointerMode}
          keyboardOpen={keyboardOpen}
          dragHeld={dragHeld}
          onViewOnly={releaseControl}
          onRequestControl={onRequestControl}
          onToggleLockLocal={onToggleLockLocal}
          onTogglePointerMode={() => setPointerMode(m => (m === 'touch' ? 'trackpad' : 'touch'))}
          onToggleKeyboard={() => setKeyboardOpen(open => !open)}
          onDoubleClick={onDoubleClick}
          onToggleDrag={onToggleDrag}
          onStop={onStop}
        />

        <KeyboardOverlay
          visible={keyboardOpen && controlLive}
          send={sendInput}
          onClose={() => setKeyboardOpen(false)}
        />

        <View style={{ height: insets.bottom, backgroundColor: theme.colors.coal }} />
      </Animated.View>
    </View>
  );
}

const makeStyles = (theme: Theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.black,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.md,
    paddingHorizontal: theme.space.md,
    paddingBottom: theme.space.sm,
    backgroundColor: theme.colors.coal,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.hairline,
  },
  back: {
    padding: theme.space.sm,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  deviceName: {
    ...type.heading,
    fontSize: 15,
    lineHeight: 18,
    color: theme.colors.paper,
  },
  headerMeta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.sm,
  },
  dot: {
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.colors.faint,
  },
  viewportWrap: {
    flex: 1,
    position: 'relative' as const,
  },
  chromeToggle: {
    position: 'absolute' as const,
    right: theme.space.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.paper, 0.2),
    backgroundColor: withAlpha(theme.colors.black, 0.5),
  },
  rotateHint: {
    position: 'absolute' as const,
    alignSelf: 'center' as const,
    top: theme.space.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: 5,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.amber, 0.4),
    backgroundColor: withAlpha(theme.colors.black, 0.55),
  },
  controlBanner: {
    position: 'absolute' as const,
    alignSelf: 'center' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: theme.space.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.coral, 0.45),
    backgroundColor: withAlpha(theme.colors.black, 0.6),
  },
});

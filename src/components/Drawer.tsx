/**
 * The navigation drawer.
 *
 * Built on React Native's own `Animated` + `PanResponder` rather than `@react-navigation/drawer`,
 * for two concrete reasons rather than preference:
 *
 *  1. VERSION. `@react-navigation/drawer` requires `react-native-reanimated`, whose current peer
 *     range tops out at React Native 0.83–0.86. This app is on 0.87.
 *
 *  2. GESTURE CONFLICT — the more important one. That drawer also requires
 *     `react-native-gesture-handler`, which installs a second, competing gesture system at the root
 *     of the tree. The remote-desktop viewport is driven by a `PanResponder` that must win every
 *     touch it receives: a drag there is moving someone's mouse pointer. Putting a rival recogniser
 *     above it risks an edge-swipe stealing a drag mid-gesture and stranding a held mouse button on
 *     a live desktop.
 *
 * So this is deliberately ~200 lines of Animated instead of two native modules. Both animated
 * properties run on the native driver, and the drawer is unmounted (not just translated off-screen)
 * while closed, so its content does not poll or hold subscriptions in the background.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Dimensions,
  PanResponder,
  Pressable as RNPressable,
  View,
} from 'react-native';

import { duration, easing, type Theme, useThemedStyles, withAlpha } from '../theme';

/** Drawer width: 82% of the screen, capped so it does not become a full-bleed sheet on a tablet. */
function drawerWidth(): number {
  const { width } = Dimensions.get('window');
  return Math.min(width * 0.82, 340);
}

/** How far in from the left edge a swipe can start the drawer. */
const EDGE_ZONE_PT = 24;
/** Past this fraction of the drawer's width, releasing settles it open rather than closed. */
const SETTLE_FRACTION = 0.4;
/** A fast flick settles in its own direction regardless of position. */
const FLICK_VELOCITY = 0.5;

export type DrawerProps = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** The drawer panel's content. */
  renderContent: () => React.ReactNode;
  /** The screen behind it. */
  children: React.ReactNode;
  /**
   * Set false on screens that must not be swiped from the edge — the live session, where a stray
   * edge-swipe would interrupt remote control. The drawer can still be opened programmatically.
   */
  swipeEnabled?: boolean;
};

export function Drawer({
  open,
  onOpen,
  onClose,
  renderContent,
  children,
  swipeEnabled = true,
}: DrawerProps) {
  const styles = useThemedStyles(makeStyles);
  const width = useMemo(drawerWidth, []);

  /** 0 = closed, 1 = fully open. Drives both the panel slide and the scrim fade. */
  const progress = useRef(new Animated.Value(0)).current;
  /**
   * Mounted separately from `open` so the closing animation can finish before the content unmounts.
   * Without it the panel would vanish instantly instead of sliding out.
   */
  const [mounted, setMounted] = useState(open);
  /** Read inside gesture callbacks without making them depend on `open`. */
  const openRef = useRef(open);
  openRef.current = open;

  const settle = useCallback(
    (toOpen: boolean, onDone?: () => void) => {
      Animated.timing(progress, {
        toValue: toOpen ? 1 : 0,
        duration: toOpen ? duration.slow : duration.base,
        easing: easing.standard,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          onDone?.();
        }
      });
    },
    [progress],
  );

  useEffect(() => {
    if (open) {
      setMounted(true);
      settle(true);
      return;
    }
    settle(false, () => setMounted(false));
  }, [open, settle]);

  // Android hardware back closes the drawer before it does anything else — the standard
  // expectation, and it must be registered here rather than per-screen so it wins while open.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose, open]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claim a touch only when it is plausibly a drawer gesture: near the left edge while closed,
        // or anywhere while open. Everything else falls through to the screen untouched — which is
        // what keeps a list scroll or a viewport drag from being intercepted.
        onMoveShouldSetPanResponder: (event, gesture) => {
          if (!swipeEnabled) {
            return false;
          }
          const horizontal = Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.6;
          if (!horizontal || Math.abs(gesture.dx) < 8) {
            return false;
          }
          if (openRef.current) {
            return gesture.dx < 0; // only a closing swipe
          }
          return event.nativeEvent.pageX <= EDGE_ZONE_PT && gesture.dx > 0;
        },

        onPanResponderMove: (_event, gesture) => {
          const base = openRef.current ? width : 0;
          const next = Math.max(0, Math.min(width, base + gesture.dx));
          progress.setValue(next / width);
        },

        onPanResponderRelease: (_event, gesture) => {
          const base = openRef.current ? width : 0;
          const travelled = Math.max(0, Math.min(width, base + gesture.dx)) / width;
          // A deliberate flick beats position, so a short fast swipe still works.
          if (gesture.vx > FLICK_VELOCITY) {
            onOpen();
            return;
          }
          if (gesture.vx < -FLICK_VELOCITY) {
            onClose();
            return;
          }
          if (travelled > SETTLE_FRACTION) {
            onOpen();
          } else {
            onClose();
          }
        },

        onPanResponderTerminate: () => settle(openRef.current),
      }),
    [onClose, onOpen, progress, settle, swipeEnabled, width],
  );

  return (
    <View style={styles.root} {...responder.panHandlers}>
      {children}

      {mounted ? (
        <>
          {/* Scrim. Tapping it closes — the fastest way out, and it also blocks touches from
              reaching the screen behind while the drawer is open. */}
          <Animated.View
            style={[styles.scrim, { opacity: progress }]}
            // Ignore touches once the drawer is closing, so a tap during the exit animation does not
            // land on a scrim that is about to disappear.
            pointerEvents={open ? 'auto' : 'none'}
          >
            <RNPressable
              style={styles.scrimFill}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close menu"
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.panel,
              {
                width,
                transform: [
                  {
                    translateX: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-width, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            {renderContent()}
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}

const makeStyles = (theme: Theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.ink,
  },
  scrim: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: withAlpha(theme.colors.black, 0.6),
  },
  scrimFill: {
    flex: 1,
  },
  panel: {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: theme.colors.coal,
    borderRightWidth: 1,
    borderRightColor: theme.colors.hairline,
  },
});

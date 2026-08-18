/**
 * DRS Mobile — application root.
 *
 * A controller/viewer for the existing DRS control plane: it authenticates against the Go backend,
 * lists the managed desktops that backend authorizes, opens a live session over the existing
 * /ws/session signaling relay, renders the agent's WebRTC video, and — only when the backend has
 * granted it — sends mouse and keyboard input over the peer-to-peer "drs-input" data channel.
 *
 * It captures nothing itself. The managed desktop's agent is the offerer and the media source; this
 * app is the answerer.
 *
 * Provider order matters:
 *   SafeAreaProvider → insets must exist before any screen measures itself
 *   ThemeProvider    → every screen's StyleSheet is built from the resolved palette
 *   AuthProvider     → owns the token the navigator switches stacks on
 */
import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppNavigation } from './src/navigation/AppNavigation';
import { AuthProvider } from './src/state/AuthContext';
import { ThemeProvider, useTheme } from './src/theme';
import { initSound, releaseSound } from './src/utils/sound';

function Root() {
  const theme = useTheme();

  // Preload the cue set once, at the top, so the first press is not late. Sound is this app's
  // feedback channel — there are no haptics anywhere in it — so a cold cue is a missing response.
  useEffect(() => {
    initSound();
    return () => releaseSound();
  }, []);

  return (
    <>
      {/* No backgroundColor: RN 0.87 went edge-to-edge on Android and dropped the prop. Each
          screen paints its own background behind the status bar instead. */}
      <StatusBar barStyle={theme.isDark ? 'light-content' : 'dark-content'} />
      <AuthProvider>
        <AppNavigation />
      </AuthProvider>
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Root />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

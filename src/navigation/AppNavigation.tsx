/**
 * Navigation.
 *
 * React Navigation's native stack, so screen transitions are driven by the platform's own navigator
 * (UINavigationController / Fragment transitions) rather than reimplemented in JS. That is not a
 * stylistic choice: a JS-driven transition competes for the same thread as the session's signaling
 * and gesture handling, and the frame it drops is the one where the operator is mid-drag.
 *
 * Two stacks, SWAPPED on authentication state rather than navigated between. Swapping means the
 * signed-out stack cannot be reached by going "back" from the device list, and — more importantly —
 * that a revoked session unmounts every authenticated screen at once, tearing down any live session
 * with it. A `navigate('Login')` would leave the session screen alive underneath, still holding a
 * peer connection and possibly still authorized for input.
 *
 * The session screen opts out of the normal transition and gesture handling:
 *   • `animation: 'fade'` — a slide animates the RTCView's native surface, which flickers on Android
 *     as the video renderer is reparented mid-transition.
 *   • `gestureEnabled: false` — an edge swipe must not silently abandon a session that is holding
 *     remote control. Leaving goes through the session screen's own confirm, which releases control
 *     and closes the socket in the right order.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import {
  NavigationContainer,
  useNavigationContainerRef,
  type Theme as NavigationTheme,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';

import { Drawer } from '../components/Drawer';
import { DrawerContent, type DrawerRoute } from '../components/DrawerContent';
import { Eyebrow } from '../components/Eyebrow';
import { AuditScreen } from '../screens/AuditScreen';
import { DeviceDetailsScreen } from '../screens/DeviceDetailsScreen';
import { DevicesScreen } from '../screens/DevicesScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { RemoteSessionScreen } from '../screens/RemoteSessionScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { useAuth } from '../state/AuthContext';
import { fonts, useTheme } from '../theme';
import type { Device } from '../types/device';

/**
 * Route params. The whole Device is passed rather than just an id, so the details screen renders
 * instantly from what the list already had and then refreshes itself — opening to a spinner it did
 * not need is the most avoidable kind of slowness.
 */
export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  Devices: undefined;
  Audit: undefined;
  Settings: undefined;
  DeviceDetails: { device: Device };
  RemoteSession: { device: Device; withControl: boolean };
};

/**
 * Drawer state, shared by the screens that can open it.
 *
 * It lives in context rather than being threaded through route params because the drawer wraps the
 * navigator: a screen needs to ask it to open without knowing anything about where it is mounted.
 * The fleet counts ride along so the drawer can display them without a second poll of /api/devices.
 */
type DrawerControls = {
  open: () => void;
  navigate: (route: DrawerRoute) => void;
  setFleet: (fleet: { online: number; total: number }) => void;
};

const DrawerContext = React.createContext<DrawerControls | null>(null);

function useDrawerControls(): DrawerControls {
  return (
    React.useContext(DrawerContext) ?? {
      open: () => {},
      navigate: () => {},
      setFleet: () => {},
    }
  );
}

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Which drawer entry to highlight for the focused route.
 *
 * The stack has routes the drawer does not list — DeviceDetails is pushed from both Home and
 * Devices, and RemoteSession from DeviceDetails. Those map back to Devices rather than to nothing,
 * so opening the drawer mid-drilldown shows where in the app you are instead of no selection at
 * all.
 */
function drawerRouteOf(routeName: string): DrawerRoute {
  switch (routeName) {
    case 'Home':
    case 'Audit':
    case 'Settings':
      return routeName;
    default:
      return 'Devices';
  }
}

function HomeRoute({ navigation }: NativeStackScreenProps<RootStackParamList, 'Home'>) {
  const drawer = useDrawerControls();
  const onOpenDevice = useCallback(
    (device: Device) => navigation.navigate('DeviceDetails', { device }),
    [navigation],
  );
  return (
    <HomeScreen
      onOpenMenu={drawer.open}
      onOpenDevice={onOpenDevice}
      onFleetChange={drawer.setFleet}
    />
  );
}

function DevicesRoute({ navigation }: NativeStackScreenProps<RootStackParamList, 'Devices'>) {
  const drawer = useDrawerControls();
  const onOpenDevice = useCallback(
    (device: Device) => navigation.navigate('DeviceDetails', { device }),
    [navigation],
  );
  return (
    <DevicesScreen
      onOpenDevice={onOpenDevice}
      onOpenMenu={drawer.open}
      onFleetChange={drawer.setFleet}
    />
  );
}

function AuditRoute() {
  const drawer = useDrawerControls();
  return <AuditScreen onOpenMenu={drawer.open} />;
}

function SettingsRoute() {
  const drawer = useDrawerControls();
  return <SettingsScreen onOpenMenu={drawer.open} />;
}

function DeviceDetailsRoute({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'DeviceDetails'>) {
  const onStartSession = useCallback(
    (device: Device, withControl: boolean) =>
      navigation.navigate('RemoteSession', { device, withControl }),
    [navigation],
  );
  return (
    <DeviceDetailsScreen
      device={route.params.device}
      onBack={navigation.goBack}
      onStartSession={onStartSession}
    />
  );
}

function RemoteSessionRoute({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'RemoteSession'>) {
  return (
    <RemoteSessionScreen
      device={route.params.device}
      withControl={route.params.withControl}
      onExit={navigation.goBack}
    />
  );
}

export function AppNavigation() {
  const theme = useTheme();
  const { token, restoring } = useAuth();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeRoute, setActiveRoute] = useState<string>('Home');
  const [fleet, setFleet] = useState<{ online: number; total: number } | undefined>();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  /**
   * Track the focused route so the drawer can disable its edge-swipe on the session screen and
   * highlight the current destination. Read from the navigator rather than mirrored into state by
   * each screen, so it cannot drift out of sync with where the user actually is.
   */
  const onStateChange = useCallback(() => {
    const name = navigationRef.getCurrentRoute()?.name;
    if (name) {
      setActiveRoute(name);
    }
  }, [navigationRef]);

  /**
   * Drawer navigation RESETS rather than pushes. Devices and Audit are siblings, not a hierarchy —
   * pushing would stack Devices → Audit → Devices → … and leave the back gesture walking a history
   * the drawer never implied.
   */
  const navigateFromDrawer = useCallback(
    (route: DrawerRoute) => {
      navigationRef.reset({ index: 0, routes: [{ name: route }] });
      setActiveRoute(route);
    },
    [navigationRef],
  );

  const drawerControls = useMemo(
    () => ({ open: openDrawer, navigate: navigateFromDrawer, setFleet }),
    [navigateFromDrawer, openDrawer],
  );

  // Sign-out must not leave the drawer open over the login screen.
  useEffect(() => {
    if (!token) {
      setDrawerOpen(false);
    }
  }, [token]);

  /**
   * React Navigation's own theme, so the container's background matches ours. Without it the
   * navigator paints its default white behind every transition, which flashes on a dark UI at the
   * exact moment a screen is pushed.
   */
  const navigationTheme = useMemo<NavigationTheme>(
    () => ({
      dark: theme.isDark,
      colors: {
        primary: theme.colors.coral,
        background: theme.colors.ink,
        card: theme.colors.coal,
        text: theme.colors.paper,
        border: theme.colors.hairline,
        notification: theme.colors.coral,
      },
      fonts: {
        regular: { fontFamily: fonts.sans, fontWeight: '400' },
        medium: { fontFamily: fonts.sans, fontWeight: '500' },
        bold: { fontFamily: fonts.sans, fontWeight: '700' },
        heavy: { fontFamily: fonts.sans, fontWeight: '800' },
      },
    }),
    [theme],
  );

  // Cold start: hold a neutral splash while the stored session is restored and verified against
  // /api/auth/me. Rendering the login screen first would flash it at every launch for an operator
  // who is already signed in.
  if (restoring) {
    return (
      <View style={[styles.splash, { backgroundColor: theme.colors.ink }]}>
        <ActivityIndicator size="large" color={theme.colors.coral} />
        <Eyebrow size={9} color={theme.colors.muted} tracking={0.24}>
          Restoring session
        </Eyebrow>
      </View>
    );
  }

  return (
    <NavigationContainer theme={navigationTheme} ref={navigationRef} onStateChange={onStateChange}>
      <DrawerContext.Provider value={drawerControls}>
        <Drawer
          open={drawerOpen}
          onOpen={openDrawer}
          onClose={closeDrawer}
          // Edge-swipe is DISABLED during a live session. A swipe from the left edge there is a
          // remote cursor drag starting near the screen edge, and letting the drawer claim it would
          // both interrupt control and risk stranding a held mouse button on the desktop. The
          // session screen has no menu button either — leaving it goes through its own confirm.
          swipeEnabled={Boolean(token) && activeRoute !== 'RemoteSession'}
          renderContent={() => (
            <DrawerContent
              active={drawerRouteOf(activeRoute)}
              onNavigate={navigateFromDrawer}
              onClose={closeDrawer}
              fleet={fleet}
            />
          )}
        >
          <Stack.Navigator
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.colors.ink },
              animation: 'slide_from_right',
            }}
          >
            {!token ? (
              <Stack.Screen name="Login" component={LoginScreen} options={{ animation: 'fade' }} />
            ) : (
              <>
                {/* Home is first, so it is the initial route: one request
                    (/api/stats/overview) answers "is anything wrong?" without a fan-out. */}
                <Stack.Screen name="Home" component={HomeRoute} />
                <Stack.Screen name="Devices" component={DevicesRoute} />
                <Stack.Screen name="Audit" component={AuditRoute} />
                <Stack.Screen name="Settings" component={SettingsRoute} />
                <Stack.Screen name="DeviceDetails" component={DeviceDetailsRoute} />
                <Stack.Screen
                  name="RemoteSession"
                  component={RemoteSessionRoute}
                  options={{
                    animation: 'fade',
                    gestureEnabled: false,
                    // The session owns the whole screen; the OS bars would only cover the picture.
                    statusBarHidden: true,
                  }}
                />
              </>
            )}
          </Stack.Navigator>
        </Drawer>
      </DrawerContext.Provider>
    </NavigationContainer>
  );
}

const styles = {
  splash: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 16,
  },
};

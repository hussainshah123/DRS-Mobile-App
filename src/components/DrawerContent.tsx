/**
 * What the drawer actually contains.
 *
 * The app previously had no home for anything that was not a device: the operator's identity, which
 * backend they were pointed at, whether control cues were audible, and the audit log the backend
 * writes about them. Those were either invisible or buried on the login screen. This is where they
 * live now.
 *
 * The ordering is deliberate — identity first, then fleet state, then destinations, then the
 * environment facts (server, TLS), then appearance, then sign out last and visually separated so it
 * is never a mis-tap.
 */
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getApiBase, isSecureBackend } from '../config/env';
import { useAuth } from '../state/AuthContext';
import { type Theme, useTheme, useThemedStyles, withAlpha } from '../theme';
import { type } from '../theme/typography';
import { canOpenSession, displayName } from '../types/user';
import { isMuted, setMuted } from '../utils/sound';
import { Eyebrow, Readout } from './Eyebrow';
import {
  IconAlert,
  IconEye,
  IconInfo,
  IconLock,
  IconMonitor,
  IconShield,
  IconSignOut,
  type IconProps,
} from './Icons';
import { Pressable } from './Pressable';
import { StatusDot } from './StatusDot';

/** The drawer's destinations. Kept in sync with the navigator's route names. */
export type DrawerRoute = 'Devices' | 'Audit';

export type DrawerContentProps = {
  active: DrawerRoute;
  onNavigate: (route: DrawerRoute) => void;
  onClose: () => void;
  /** Live fleet counts, passed in so the drawer does not run a second poll of its own. */
  fleet?: { online: number; total: number };
};

export function DrawerContent({ active, onNavigate, onClose, fleet }: DrawerContentProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();

  // Sound-muting lives in a module singleton rather than React state (it is read from non-React code
  // paths like the session controller), so the toggle mirrors it locally to force a re-render.
  const [muted, setMutedState] = React.useState(isMuted());
  const toggleMuted = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
  };

  const secure = isSecureBackend();
  const mayConnect = canOpenSession(user);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + theme.space.xl, paddingBottom: insets.bottom + theme.space.xl },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Identity. The name here is the one the backend stamps into the device's on-screen consent
          notice, so showing it is not decoration — it is what the person at the remote keyboard
          will read. */}
      <View style={styles.identity}>
        <View style={styles.avatar}>
          <Eyebrow size={15} color={theme.colors.coral} tracking={0.04}>
            {(displayName(user) || '?').slice(0, 1).toUpperCase()}
          </Eyebrow>
        </View>
        <Text style={styles.name} numberOfLines={1}>
          {displayName(user) || 'Signed in'}
        </Text>
        <Readout size={11} color={theme.colors.faint} numberOfLines={1}>
          {user?.email ?? ''}
        </Readout>
        <View style={styles.roleChip}>
          <Eyebrow size={8} color={theme.colors.lime} tracking={0.2}>
            {user?.role ?? 'unknown'}
          </Eyebrow>
        </View>
        <Text style={styles.roleNote}>
          {mayConnect
            ? 'You can open remote sessions and request control.'
            : 'View-only account — opening a remote session needs an administrator role.'}
        </Text>
      </View>

      {/* Fleet at a glance, so the drawer answers "is anything up?" without navigating. */}
      {fleet ? (
        <View style={styles.fleetCard}>
          <View style={styles.fleetRow}>
            <StatusDot color={theme.colors.lime} size={7} pulse={fleet.online > 0} />
            <Readout size={13} bold color={theme.colors.paper}>
              {fleet.online}
            </Readout>
            <Eyebrow size={9} color={theme.colors.muted} tracking={0.16}>
              online
            </Eyebrow>
            <View style={styles.flex} />
            <Readout size={11} color={theme.colors.faint}>
              of {fleet.total}
            </Readout>
          </View>
        </View>
      ) : null}

      <Section label="Navigate">
        <NavItem
          icon={IconMonitor}
          label="Devices"
          detail="The managed fleet"
          active={active === 'Devices'}
          onPress={() => {
            onNavigate('Devices');
            onClose();
          }}
        />
        <NavItem
          icon={IconShield}
          label="Audit trail"
          detail="Sessions and control changes"
          active={active === 'Audit'}
          onPress={() => {
            onNavigate('Audit');
            onClose();
          }}
        />
      </Section>

      <Section label="Backend">
        <View style={styles.infoRow}>
          <IconLock size={14} color={secure ? theme.colors.lime : theme.colors.amber} />
          <Readout size={10} color={theme.colors.muted} style={styles.flex} numberOfLines={1}>
            {getApiBase().replace(/^https?:\/\//, '')}
          </Readout>
          <Eyebrow size={8} color={secure ? theme.colors.lime : theme.colors.amber} tracking={0.16}>
            {secure ? 'TLS' : 'Plain'}
          </Eyebrow>
        </View>
        {!secure ? (
          <View style={styles.warnRow}>
            <IconAlert size={13} color={theme.colors.amber} />
            <Text style={styles.warnText}>
              This connection is not encrypted. Sign out and switch to an https:// server before
              using it for real work.
            </Text>
          </View>
        ) : null}
      </Section>

      <Section label="Preferences">
        <NavItem
          icon={muted ? IconInfo : IconEye}
          label={muted ? 'Sounds muted' : 'Sounds on'}
          detail={
            muted
              ? 'Control changes are silent — tap to restore'
              : 'Control changes are announced audibly'
          }
          active={!muted}
          activeColor={theme.colors.amber}
          onPress={toggleMuted}
        />
        <NavItem
          icon={IconInfo}
          label={theme.override === null ? 'Theme: system' : `Theme: ${theme.name}`}
          detail="Tap to cycle system → dark → light"
          onPress={() => {
            // Cycle rather than offer three buttons: it is one control instead of three in a
            // narrow panel, and the current state is always written out above.
            theme.setOverride(
              theme.override === null ? 'dark' : theme.override === 'dark' ? 'light' : null,
            );
          }}
        />
      </Section>

      <View style={styles.spacer} />

      <Pressable
        style={styles.signOut}
        onPress={() => {
          onClose();
          void signOut();
        }}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
      >
        <IconSignOut size={16} color={theme.colors.coral} />
        <Eyebrow size={10} color={theme.colors.coral} tracking={0.16}>
          Sign out
        </Eyebrow>
      </Pressable>

      <Text style={styles.footnote}>
        Every session you open and every control grant you request is recorded in the audit trail,
        and the device shows a notice naming you while you are connected.
      </Text>
    </ScrollView>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.section}>
      <Eyebrow size={8} color={theme.colors.lime} tracking={0.26}>
        {label}
      </Eyebrow>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function NavItem({
  icon: Icon,
  label,
  detail,
  active = false,
  activeColor,
  onPress,
}: {
  icon: React.ComponentType<IconProps>;
  label: string;
  detail?: string;
  active?: boolean;
  activeColor?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const accent = activeColor ?? theme.colors.coral;
  const tint = active ? accent : theme.colors.muted;

  return (
    <Pressable
      style={[
        styles.navItem,
        active && {
          backgroundColor: withAlpha(accent, 0.1),
          borderColor: withAlpha(accent, 0.3),
        },
      ]}
      onPress={onPress}
      scaleTo={0.98}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
    >
      <Icon size={17} color={tint} />
      <View style={styles.navText}>
        <Text style={[styles.navLabel, { color: active ? theme.colors.paper : theme.colors.paper }]}>
          {label}
        </Text>
        {detail ? (
          <Text style={styles.navDetail} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const makeStyles = (theme: Theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.coal,
  },
  content: {
    paddingHorizontal: theme.space.lg,
    gap: theme.space.xl,
  },
  flex: {
    flex: 1,
  },
  identity: {
    gap: theme.space.xs,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: withAlpha(theme.colors.coral, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.coral, 0.3),
    marginBottom: theme.space.sm,
  },
  name: {
    ...type.heading,
    fontSize: 17,
    color: theme.colors.paper,
  },
  roleChip: {
    alignSelf: 'flex-start' as const,
    marginTop: theme.space.xs,
    paddingHorizontal: theme.space.sm,
    paddingVertical: 3,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.lime, 0.3),
    backgroundColor: withAlpha(theme.colors.lime, 0.1),
  },
  roleNote: {
    ...type.caption,
    fontSize: 12,
    lineHeight: 17,
    color: theme.colors.faint,
    marginTop: theme.space.xs,
  },
  fleetCard: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.sand,
    padding: theme.space.md,
  },
  fleetRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.sm,
  },
  section: {
    gap: theme.space.md,
  },
  sectionBody: {
    gap: theme.space.sm,
  },
  navItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  navText: {
    flex: 1,
    gap: 1,
  },
  navLabel: {
    ...type.body,
    fontSize: 14,
  },
  navDetail: {
    ...type.caption,
    fontSize: 11,
    lineHeight: 15,
    color: theme.colors.faint,
  },
  infoRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
  },
  warnRow: {
    flexDirection: 'row' as const,
    gap: theme.space.sm,
    padding: theme.space.md,
    borderRadius: theme.radius.sm,
    backgroundColor: withAlpha(theme.colors.amber, 0.1),
  },
  warnText: {
    ...type.caption,
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    color: theme.colors.amber,
  },
  spacer: {
    height: theme.space.sm,
  },
  signOut: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: theme.space.sm,
    paddingVertical: theme.space.md,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.coral, 0.3),
    backgroundColor: withAlpha(theme.colors.coral, 0.08),
  },
  footnote: {
    ...type.caption,
    fontSize: 10,
    lineHeight: 15,
    color: withAlpha(theme.colors.faint, 0.9),
    textAlign: 'center' as const,
  },
});

/**
 * Account settings — the operator's own profile and password.
 *
 * Two forms against two existing endpoints (`PUT /api/auth/profile`, `PUT /api/auth/password`). No
 * user administration: `/api/users` is superadmin-only and managing other people's accounts is a
 * console task, not something to do one-handed in the field.
 *
 * The display name is not cosmetic, which is why it is editable here at all. The backend stamps it
 * into `StartSession.Operator`, and that string is what the managed desktop prints on its consent
 * notice — "<operator> is viewing this device". An operator with a blank profile appears on a
 * colleague's screen as a bare username.
 *
 * THE CRITICAL BEHAVIOUR ON THIS SCREEN is the wrong-current-password case. The backend answers a
 * bad current password with a 401 carrying no `code`, and the API client's revocation set is what
 * keeps that from being read as "your session ended" and throwing the operator back to sign-in
 * mid-form. That contract is pinned by __tests__/apiClient.test.ts; this screen relies on it and
 * shows the error inline instead.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { changePassword, updateProfile } from '../api/auth';
import { ApiError } from '../api/client';
import { Button } from '../components/Button';
import { Eyebrow, Readout } from '../components/Eyebrow';
import { IconEye, IconEyeOff, IconLock, IconMenu, IconShield } from '../components/Icons';
import { Pressable } from '../components/Pressable';
import { Reveal } from '../components/Reveal';
import { useAuth } from '../state/AuthContext';
import { type Theme, useTheme, useThemedStyles, withAlpha } from '../theme';
import { type } from '../theme/typography';
import { canOpenSession, displayName, type User } from '../types/user';
import { describeError } from '../utils/logger';
import { play } from '../utils/sound';

/**
 * Mirrors the server-side limits in auth_handler.go exactly (80 chars for a name; 8–72 for a
 * password, and it must differ from the current one). Validating client-side is not a substitute for
 * the server's check — it is so the operator finds out before a round trip, and so the 72-byte bcrypt
 * ceiling is a visible rule rather than a mysterious rejection.
 */
const NAME_MAX = 80;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;

/**
 * passwordProblem returns the first reason a change should not be sent, or '' when it is fine.
 *
 * Pure and exported so the rules can be tested without mounting a screen — and so the order of the
 * checks is fixed. Order matters: reporting "does not match" for a pair of identical 4-character
 * passwords would send the operator hunting for a typo that is not there.
 */
export function passwordProblem(current: string, next: string, confirm: string): string {
  if (next.length < PASSWORD_MIN) {
    return `New password must be at least ${PASSWORD_MIN} characters.`;
  }
  if (next.length > PASSWORD_MAX) {
    return `New password must be ${PASSWORD_MAX} characters or fewer.`;
  }
  if (next === current) {
    return 'New password must be different from your current one.';
  }
  if (next !== confirm) {
    return 'The two new passwords do not match.';
  }
  return '';
}

export type SettingsScreenProps = {
  onOpenMenu: () => void;
};

export function SettingsScreen({ onOpenMenu }: SettingsScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { user, updateUser, signOut } = useAuth();

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + theme.space.lg }]}>
        <Pressable
          style={styles.menu}
          onPress={onOpenMenu}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
        >
          <IconMenu size={18} color={theme.colors.paper} />
        </Pressable>
        <View style={styles.headerText}>
          <Eyebrow size={9} color={theme.colors.lime} tracking={0.26}>
            Your account
          </Eyebrow>
          <Text style={styles.title}>Settings</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + theme.space.xxl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Reveal index={0}>
          <View style={styles.identityCard}>
            <View style={styles.identityRow}>
              <View style={styles.avatar}>
                <Eyebrow size={16} color={theme.colors.coral} tracking={0.04}>
                  {(displayName(user) || '?').slice(0, 1).toUpperCase()}
                </Eyebrow>
              </View>
              <View style={styles.identityText}>
                <Text style={styles.identityName} numberOfLines={1}>
                  {displayName(user) || 'Signed in'}
                </Text>
                <Readout size={11} color={theme.colors.faint} numberOfLines={1}>
                  {user?.email ?? ''}
                </Readout>
              </View>
              <View style={styles.roleChip}>
                <Eyebrow size={8} color={theme.colors.lime} tracking={0.2}>
                  {user?.role ?? 'unknown'}
                </Eyebrow>
              </View>
            </View>
            {/* Say plainly what the role permits. A view-only operator otherwise discovers it as a
                disabled Connect button with no explanation. */}
            <View style={styles.roleNoteRow}>
              <IconShield size={13} color={canOpenSession(user) ? theme.colors.lime : theme.colors.amber} />
              <Text style={styles.roleNote}>
                {canOpenSession(user)
                  ? 'This account can open remote sessions and request control.'
                  : 'View-only account. Opening a remote session needs an administrator role — ask a superadmin to change it.'}
              </Text>
            </View>
          </View>
        </Reveal>

        <Reveal index={1}>
          <ProfileForm
            initialName={user?.full_name ?? ''}
            username={user?.username ?? ''}
            onUpdated={updateUser}
          />
        </Reveal>

        <Reveal index={2}>
          <PasswordForm />
        </Reveal>

        <Reveal index={3}>
          <View style={styles.dangerBlock}>
            <Button
              label="Sign out"
              intent="danger"
              block
              onPress={() => {
                void signOut();
              }}
            />
            <Text style={styles.footnote}>
              Signing out clears the stored token from this device's keystore. Any live session ends
              with it, and the desktop's consent notice disappears.
            </Text>
          </View>
        </Reveal>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * Display name.
 *
 * The save button stays disabled until the value actually differs from what the server holds —
 * a no-op PUT would still write an audit row and re-render the consent name for no reason.
 */
function ProfileForm({
  initialName,
  username,
  onUpdated,
}: {
  initialName: string;
  username: string;
  onUpdated: (user: User) => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const trimmed = name.trim();
  const dirty = trimmed !== initialName.trim();
  const tooLong = trimmed.length > NAME_MAX;
  const canSave = dirty && trimmed.length > 0 && !tooLong && !saving;

  const submit = useCallback(async () => {
    if (!canSave) {
      return;
    }
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const updated = await updateProfile(trimmed);
      onUpdated(updated);
      setSaved(true);
    } catch (err) {
      // A revoked session is handled globally; anything else belongs on the form.
      if (!(err instanceof ApiError && err.status === 401 && err.code)) {
        setError(describeError(err, 'Could not update your name.'));
        play('error');
      }
    } finally {
      setSaving(false);
    }
  }, [canSave, onUpdated, trimmed]);

  return (
    <View style={styles.card}>
      <Eyebrow size={9} color={theme.colors.muted} tracking={0.22}>
        Display name
      </Eyebrow>
      <Text style={styles.cardNote}>
        This is the name the managed desktop shows on its consent notice while you are connected.
      </Text>
      <TextInput
        value={name}
        onChangeText={text => {
          setName(text);
          setError('');
          setSaved(false);
        }}
        placeholder={username || 'Your name'}
        placeholderTextColor={theme.colors.faint}
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={NAME_MAX}
        returnKeyType="done"
        onSubmitEditing={submit}
        keyboardAppearance={theme.isDark ? 'dark' : 'light'}
        style={styles.input}
        editable={!saving}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {saved && !dirty ? (
        <Text style={styles.successText}>Saved. Sessions you open from now on will use it.</Text>
      ) : null}
      <Button
        label="Save name"
        intent="secondary"
        onPress={submit}
        disabled={!canSave}
        loading={saving}
        block
      />
    </View>
  );
}

/**
 * Password change.
 *
 * The confirm field is a client-side addition — the backend takes only current and new. It is here
 * because a mistyped new password on a phone keyboard is otherwise undiscoverable: the change
 * succeeds, and the operator is locked out at the next cold start with a token that still works
 * until it expires.
 */
function PasswordForm() {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const nextRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const confirmRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  const filled = current.length > 0 && next.length > 0 && confirm.length > 0;

  const submit = useCallback(async () => {
    if (!filled || saving) {
      return;
    }
    const problem = passwordProblem(current, next, confirm);
    if (problem) {
      setError(problem);
      setDone(false);
      play('error');
      return;
    }
    setSaving(true);
    setError('');
    setDone(false);
    try {
      await changePassword(current, next);
      // Clear every field on success. The token stays valid — the backend does not invalidate it on
      // a password change — but leaving the new password sitting in component state serves nothing.
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    } catch (err) {
      // The wrong-current-password 401 lands here, NOT in the auth context's revocation path,
      // because it carries no code. Showing it inline is the whole point.
      setError(describeError(err, 'Could not change your password.'));
      play('error');
    } finally {
      setSaving(false);
    }
  }, [confirm, current, filled, next, saving]);

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Eyebrow size={9} color={theme.colors.muted} tracking={0.22}>
          Password
        </Eyebrow>
        <Pressable
          style={styles.revealToggle}
          onPress={() => setReveal(v => !v)}
          scaleTo={0.95}
          accessibilityRole="button"
          accessibilityLabel={reveal ? 'Hide passwords' : 'Show passwords'}
        >
          {reveal ? (
            <IconEyeOff size={16} color={theme.colors.muted} />
          ) : (
            <IconEye size={16} color={theme.colors.muted} />
          )}
        </Pressable>
      </View>

      <TextInput
        value={current}
        onChangeText={text => {
          setCurrent(text);
          setError('');
          setDone(false);
        }}
        placeholder="Current password"
        placeholderTextColor={theme.colors.faint}
        secureTextEntry={!reveal}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="next"
        onSubmitEditing={() => nextRef.current?.focus()}
        keyboardAppearance={theme.isDark ? 'dark' : 'light'}
        style={styles.input}
        editable={!saving}
      />
      <TextInput
        ref={nextRef}
        value={next}
        onChangeText={text => {
          setNext(text);
          setError('');
          setDone(false);
        }}
        placeholder="New password"
        placeholderTextColor={theme.colors.faint}
        secureTextEntry={!reveal}
        autoCapitalize="none"
        autoCorrect={false}
        // 'new-password' rather than 'password': it is what makes a password manager offer to
        // generate and store one instead of autofilling the old value into all three fields.
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="next"
        onSubmitEditing={() => confirmRef.current?.focus()}
        keyboardAppearance={theme.isDark ? 'dark' : 'light'}
        style={styles.input}
        editable={!saving}
      />
      <TextInput
        ref={confirmRef}
        value={confirm}
        onChangeText={text => {
          setConfirm(text);
          setError('');
          setDone(false);
        }}
        placeholder="Repeat new password"
        placeholderTextColor={theme.colors.faint}
        secureTextEntry={!reveal}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={submit}
        keyboardAppearance={theme.isDark ? 'dark' : 'light'}
        style={styles.input}
        editable={!saving}
      />

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
      {done ? <Text style={styles.successText}>Password changed.</Text> : null}

      <View style={styles.hintRow}>
        <IconLock size={12} color={theme.colors.faint} />
        <Text style={styles.cardNote}>
          {PASSWORD_MIN}–{PASSWORD_MAX} characters. Changing it does not end this session, and it is
          recorded in the audit trail.
        </Text>
      </View>

      <Button
        label="Change password"
        intent="secondary"
        onPress={submit}
        disabled={!filled || saving}
        loading={saving}
        block
      />
    </View>
  );
}

const makeStyles = (theme: Theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.ink,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.md,
    paddingHorizontal: theme.space.xl,
    paddingBottom: theme.space.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.hairline,
  },
  menu: {
    padding: theme.space.sm,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
  },
  headerText: {
    flex: 1,
    gap: theme.space.xxs,
  },
  title: {
    ...type.title,
    fontSize: 26,
    lineHeight: 30,
    color: theme.colors.paper,
  },
  scroll: {
    padding: theme.space.xl,
    gap: theme.space.lg,
  },
  identityCard: {
    gap: theme.space.md,
    padding: theme.space.lg,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.coal,
  },
  identityRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: withAlpha(theme.colors.coral, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.coral, 0.25),
  },
  identityText: {
    flex: 1,
    gap: theme.space.xxs,
  },
  identityName: {
    ...type.heading,
    color: theme.colors.paper,
  },
  roleChip: {
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.lime, 0.3),
    backgroundColor: withAlpha(theme.colors.lime, 0.1),
  },
  roleNoteRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: theme.space.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
    paddingTop: theme.space.md,
  },
  roleNote: {
    ...type.caption,
    fontSize: 12,
    lineHeight: 17,
    flex: 1,
    color: theme.colors.muted,
  },
  card: {
    gap: theme.space.md,
    padding: theme.space.lg,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.coal,
  },
  cardHead: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: theme.space.md,
  },
  cardNote: {
    ...type.caption,
    fontSize: 12,
    lineHeight: 17,
    flex: 1,
    color: theme.colors.faint,
  },
  hintRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: theme.space.sm,
  },
  revealToggle: {
    padding: theme.space.xs,
  },
  input: {
    ...type.body,
    color: theme.colors.paper,
    backgroundColor: theme.colors.sand,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.lg,
    // Explicit vertical padding, not a height: Android's TextInput adds internal padding and a
    // fixed height clips the baseline on some OEM skins.
    paddingVertical: theme.space.md + 2,
  },
  errorBanner: {
    backgroundColor: withAlpha(theme.colors.coral, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.coral, 0.3),
    borderRadius: theme.radius.md,
    padding: theme.space.md,
  },
  errorText: {
    ...type.caption,
    color: theme.colors.coral,
  },
  successText: {
    ...type.caption,
    color: theme.colors.lime,
  },
  dangerBlock: {
    gap: theme.space.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
    paddingTop: theme.space.lg,
  },
  footnote: {
    ...type.caption,
    fontSize: 12,
    lineHeight: 17,
    color: theme.colors.faint,
  },
});

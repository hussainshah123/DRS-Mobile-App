/**
 * Sign-in.
 *
 * Signs an EXISTING operator in against the existing backend — `POST /api/auth/login`. There is
 * deliberately no signup here: onboarding a DRS operator involves an emailed code and a role
 * assignment, both of which belong on the console rather than on a field device.
 *
 * The server address is editable. That is not a debug affordance: an operator moving between a
 * lab VPS and production would otherwise need a rebuild, and hard-coding a single URL is what
 * makes a mobile client undeployable. It is collapsed by default so it does not read as a
 * required field.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { Eyebrow, Readout } from '../components/Eyebrow';
import { IconEye, IconEyeOff, IconLock, IconShield } from '../components/Icons';
import { Pressable } from '../components/Pressable';
import { Reveal } from '../components/Reveal';
import { BACKEND_PRESETS, getApiBase, isSecureBackend, setApiBase } from '../config/env';
import { useAuth } from '../state/AuthContext';
import { type Theme, useTheme, useThemedStyles, withAlpha } from '../theme';
import { type } from '../theme/typography';
import { describeError } from '../utils/logger';
import { play } from '../utils/sound';

export function LoginScreen() {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { signIn, signingIn, error, clearError } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [serverOpen, setServerOpen] = useState(false);
  const [server, setServer] = useState(getApiBase());
  const [serverError, setServerError] = useState('');
  const passwordRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  // The auth context surfaces revocation reasons through the same `error` field, so a session
  // that was killed while the app was closed explains itself here. Announce it audibly, since
  // sound is this app's feedback channel.
  useEffect(() => {
    if (error) {
      play('error');
    }
  }, [error]);

  const applyServer = useCallback(() => {
    try {
      setApiBase(server);
      setServer(getApiBase());
      setServerError('');
      setServerOpen(false);
      play('controlOn');
    } catch (err) {
      setServerError(describeError(err, 'That server address is not valid.'));
      play('error');
    }
  }, [server]);

  const submit = useCallback(async () => {
    if (!identifier.trim() || !password) {
      return;
    }
    clearError();
    const ok = await signIn(identifier, password);
    if (ok) {
      play('connect');
      // Clear the password on success. The navigator swaps this screen out, but React may keep
      // the component mounted long enough for the value to sit in memory.
      setPassword('');
    }
  }, [clearError, identifier, password, signIn]);

  const canSubmit = identifier.trim().length > 0 && password.length > 0 && !signingIn;
  const secure = isSecureBackend();

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + theme.space.xxxl, paddingBottom: insets.bottom + theme.space.xxl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Reveal>
          <View style={styles.brand}>
            <View style={styles.brandMark}>
              <IconShield size={22} color={theme.colors.coral} />
            </View>
            <Eyebrow size={10} color={theme.colors.lime} tracking={0.28}>
              DRS · Remote Desktop
            </Eyebrow>
            <Text style={styles.title}>Sign in to your fleet</Text>
            <Text style={styles.subtitle}>
              Connect to a managed desktop, view its screen live, and take control when you are
              authorized to.
            </Text>
          </View>
        </Reveal>

        <Reveal index={1} style={styles.form}>
          <Field label="Email or username">
            <TextInput
              value={identifier}
              onChangeText={text => {
                setIdentifier(text);
                if (error) {
                  clearError();
                }
              }}
              placeholder="you@company.com"
              placeholderTextColor={theme.colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              // 'username' rather than 'emailAddress': the backend accepts either, and the email
              // hint makes a password manager refuse to fill a username-only account.
              autoComplete="username"
              textContentType="username"
              keyboardType="email-address"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              keyboardAppearance={theme.isDark ? 'dark' : 'light'}
              style={styles.input}
              editable={!signingIn}
            />
          </Field>

          <Field label="Password">
            <View style={styles.passwordRow}>
              <TextInput
                ref={passwordRef}
                value={password}
                onChangeText={text => {
                  setPassword(text);
                  if (error) {
                    clearError();
                  }
                }}
                placeholder="••••••••"
                placeholderTextColor={theme.colors.faint}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={submit}
                keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                style={[styles.input, styles.passwordInput]}
                editable={!signingIn}
              />
              <Pressable
                style={styles.reveal}
                onPress={() => setShowPassword(v => !v)}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <IconEyeOff size={18} color={theme.colors.muted} />
                ) : (
                  <IconEye size={18} color={theme.colors.muted} />
                )}
              </Pressable>
            </View>
          </Field>

          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Button
            label="Sign in"
            onPress={submit}
            disabled={!canSubmit}
            loading={signingIn}
            block
            style={styles.submit}
          />
        </Reveal>

        <Reveal index={2} style={styles.serverBlock}>
          <Pressable
            style={styles.serverToggle}
            onPress={() => setServerOpen(open => !open)}
            accessibilityRole="button"
            accessibilityLabel="Change server address"
          >
            <View style={styles.serverStatus}>
              <IconLock size={13} color={secure ? theme.colors.lime : theme.colors.amber} />
              <Readout size={10} color={theme.colors.faint} numberOfLines={1}>
                {getApiBase()}
              </Readout>
            </View>
            <Eyebrow size={9} color={theme.colors.muted} tracking={0.16}>
              {serverOpen ? 'Close' : 'Change'}
            </Eyebrow>
          </Pressable>

          {/* Warn once, plainly, when traffic is not encrypted. The spec requires TLS/WSS in
              production (§13); a debug build against a LAN backend is legitimate, but the
              operator should know which one they are on. */}
          {!secure ? (
            <Text style={styles.insecureNote}>
              This server is not using TLS. Credentials and session signalling are sent in the
              clear — use https:// for anything but local development.
            </Text>
          ) : null}

          {serverOpen ? (
            <View style={styles.serverForm}>
              {/* One-tap presets. Typing a URL on a phone keyboard is error-prone, and a typo here
                  reads as "the backend is down" rather than "you mistyped the host". */}
              <View style={styles.presets}>
                {BACKEND_PRESETS.map(preset => {
                  const active = getApiBase() === preset.url;
                  return (
                    <Pressable
                      key={preset.url}
                      style={[
                        styles.preset,
                        active && {
                          backgroundColor: withAlpha(theme.colors.lime, 0.12),
                          borderColor: withAlpha(theme.colors.lime, 0.4),
                        },
                      ]}
                      onPress={() => setServer(preset.url)}
                      scaleTo={0.95}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Eyebrow
                        size={9}
                        color={active ? theme.colors.lime : theme.colors.muted}
                        tracking={0.18}
                      >
                        {preset.label}
                      </Eyebrow>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                value={server}
                onChangeText={setServer}
                placeholder="https://drs.example.com"
                placeholderTextColor={theme.colors.faint}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="done"
                onSubmitEditing={applyServer}
                keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                style={styles.input}
              />
              {serverError ? <Text style={styles.errorText}>{serverError}</Text> : null}
              <Button label="Use this server" intent="secondary" onPress={applyServer} block />
            </View>
          ) : null}
        </Reveal>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.field}>
      <Eyebrow size={9} color={theme.colors.muted} tracking={0.2}>
        {label}
      </Eyebrow>
      {children}
    </View>
  );
}

const makeStyles = (theme: Theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.ink,
  },
  scroll: {
    paddingHorizontal: theme.space.xl,
    gap: theme.space.xxl,
  },
  brand: {
    gap: theme.space.md,
  },
  brandMark: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: withAlpha(theme.colors.coral, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.coral, 0.25),
    marginBottom: theme.space.xs,
  },
  title: {
    ...type.title,
    color: theme.colors.paper,
  },
  subtitle: {
    ...type.body,
    color: theme.colors.muted,
    maxWidth: 380,
  },
  form: {
    gap: theme.space.lg,
  },
  field: {
    gap: theme.space.sm,
  },
  input: {
    ...type.body,
    color: theme.colors.paper,
    backgroundColor: theme.colors.coal,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.lg,
    // Explicit vertical padding rather than a fixed height: Android's TextInput adds its own
    // internal padding, and a fixed height clips the text baseline on some OEM skins.
    paddingVertical: theme.space.md + 2,
  },
  passwordRow: {
    position: 'relative' as const,
    justifyContent: 'center' as const,
  },
  passwordInput: {
    paddingRight: 52,
  },
  reveal: {
    bottom: 7,
    position: 'absolute' as const,
    right: theme.space.md,
    padding: theme.space.sm,
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
  submit: {
    marginTop: theme.space.xs,
  },
  serverBlock: {
    gap: theme.space.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
    paddingTop: theme.space.lg,
  },
  serverToggle: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: theme.space.md,
  },
  serverStatus: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.sm,
  },
  insecureNote: {
    ...type.caption,
    fontSize: 12,
    lineHeight: 17,
    color: theme.colors.amber,
  },
  serverForm: {
    gap: theme.space.md,
  },
  presets: {
    flexDirection: 'row' as const,
    gap: theme.space.sm,
  },
  preset: {
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.coal,
  },
});

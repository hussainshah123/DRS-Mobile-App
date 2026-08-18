/**
 * Backend location.
 *
 * The dashboard reads this from `VITE_API_URL`. React Native has no equivalent build-time env
 * injection without extra tooling, so the backends live here as named constants — and the login
 * screen can switch between them at runtime, because an operator moving between a lab box and
 * production should not need a rebuild.
 *
 * `wsBase` is DERIVED rather than configured separately, so http/ws and https/wss can never drift
 * out of step — exactly how drs/src/api/session.js derives it.
 */
import { Platform } from 'react-native';

/**
 * The deployed DRS backend.
 *
 * This is the `.nip.io` form the deployment's Caddyfile expects: Caddy provisions the TLS
 * certificate for whatever `DRS_DOMAIN` resolves to, and `<ip>.nip.io` is the documented stand-in
 * until a real domain exists (see drs/.env.deploy.example).
 *
 * It must be the nip.io NAME, not the bare IP — the certificate's only SAN is
 * `2.25.103.207.nip.io`, so `https://2.25.103.207` fails the hostname check, and React Native
 * offers no way to bypass that (nor should it).
 *
 * Verified against this host: /healthz → 200, /api/* → 401 without a token, /ws/session → 401
 * without a token, Let's Encrypt certificate valid, TURN reachable on 3478/udp.
 *
 * NOTE: nip.io is a third-party wildcard DNS service. Fine for getting started, but the app cannot
 * resolve this host if nip.io is down — so a real domain in `DRS_DOMAIN` is the right move before
 * this carries real traffic.
 */
const DEPLOYED_BACKEND = 'https://2.25.103.207.nip.io';

/**
 * A backend running on the developer's own machine.
 *
 * On Android an emulator cannot reach the host's `localhost`, so the loopback alias 10.0.2.2 is the
 * correct value there; the iOS simulator shares the host's network stack and `localhost` works.
 * Selectable from the login screen when working against a local `docker compose up`.
 */
export const LOCAL_BACKEND = Platform.select({
  android: 'http://10.0.2.2:8080',
  ios: 'http://localhost:8080',
  default: 'http://localhost:8080',
}) as string;

/**
 * Where the app points on a fresh install.
 *
 * The deployed server in BOTH dev and release builds: it is the live backend with the real fleet on
 * it, so defaulting a debug build to localhost would just mean every fresh `npm run android` failed
 * to connect. Switch to `LOCAL_BACKEND` from the login screen's server field for the local stack.
 */
const DEFAULT_BACKEND = DEPLOYED_BACKEND;

let apiBase = normalizeBase(DEFAULT_BACKEND);

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** getApiBase returns the REST base, e.g. "https://2.25.103.207.nip.io". */
export function getApiBase(): string {
  return apiBase;
}

/** getWsBase converts the REST base to its WebSocket scheme: http→ws, https→wss. */
export function getWsBase(): string {
  return apiBase.replace(/^http/i, 'ws');
}

/**
 * setApiBase points the app at a different backend at runtime. Rejects a URL without an http(s)
 * scheme so a typo becomes a visible error at the login screen instead of a confusing network
 * failure on every later call.
 */
export function setApiBase(url: string): void {
  const next = normalizeBase(url);
  if (!/^https?:\/\/.+/i.test(next)) {
    throw new Error('Server URL must start with http:// or https://');
  }
  apiBase = next;
}

/** isSecureBackend reports whether traffic is TLS-protected — surfaced in the UI. */
export function isSecureBackend(): boolean {
  return apiBase.toLowerCase().startsWith('https://');
}

/** The presets the login screen offers, so the two URLs are never retyped from memory. */
export const BACKEND_PRESETS: { label: string; url: string }[] = [
  { label: 'Deployed', url: DEPLOYED_BACKEND },
  { label: 'Local', url: LOCAL_BACKEND },
];

/** How often the device list refreshes, matching the dashboard's 5s poll. */
export const DEVICE_POLL_MS = 5000;

/**
 * Scoped logger.
 *
 * Two reasons this exists instead of bare console.log:
 *
 *  1. A remote session emits a LOT of events (ICE candidates, connection-state
 *     churn, input events). Tagging by subsystem is what makes the Metro log
 *     readable when signaling and WebRTC are interleaved.
 *
 *  2. Session logs touch credentials and screen contents. In a release build
 *     everything below `warn` is compiled out (`__DEV__` is statically false, so
 *     the branch is dead code the minifier drops) — an operator tool must not leave
 *     a device's activity in the system log.
 *
 * Never pass a token, agent secret, SDP body or frame payload to any level. Log the
 * fact and the size, not the content.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const enabled: Record<Level, boolean> = {
  debug: __DEV__,
  info: __DEV__,
  warn: true,
  error: true,
};

export type Logger = {
  debug: (msg: string, ...rest: unknown[]) => void;
  info: (msg: string, ...rest: unknown[]) => void;
  warn: (msg: string, ...rest: unknown[]) => void;
  error: (msg: string, ...rest: unknown[]) => void;
};

const sink: Record<Level, (...args: unknown[]) => void> = {
  debug: (...a) => console.log(...a),
  info: (...a) => console.log(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};

function emit(level: Level, scope: string, msg: string, rest: unknown[]) {
  if (!enabled[level]) {
    return;
  }
  sink[level](`[drs:${scope}] ${msg}`, ...rest);
}

/** createLogger returns a logger tagged with a subsystem name, e.g. 'signaling'. */
export function createLogger(scope: string): Logger {
  return {
    debug: (msg, ...rest) => emit('debug', scope, msg, rest),
    info: (msg, ...rest) => emit('info', scope, msg, rest),
    warn: (msg, ...rest) => emit('warn', scope, msg, rest),
    error: (msg, ...rest) => emit('error', scope, msg, rest),
  };
}

/**
 * describeError turns anything thrown into a message safe to show a user. Errors
 * from fetch/WebRTC/native modules arrive as Error, string, or a bare object, so
 * every catch site funnels through here rather than interpolating an unknown.
 */
export function describeError(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (typeof err === 'string' && err) {
    return err;
  }
  return fallback;
}

/**
 * A thin, typed WebSocket over the DRS envelope protocol.
 *
 * Everything DRS-specific about the transport lives here:
 *
 *  • AUTHENTICATION IS THE SUBPROTOCOL. The backend's `bearerFromWS` reads the JWT from
 *    `Sec-WebSocket-Protocol: bearer, <token>` and negotiates `bearer` back. That
 *    convention exists because a browser cannot set an Authorization header on a
 *    WebSocket. React Native *can* set headers, but we use the subprotocol anyway —
 *    matching the existing server exactly is the requirement (spec §17), and inventing a
 *    second auth path for the same endpoint would mean a backend change for no gain.
 *
 *  • PRE-UPGRADE REJECTIONS ARE HTTP, NOT CLOSE FRAMES. ServeSession authenticates
 *    BEFORE upgrading so a rejection is a clean status code. That means a 401/403 never
 *    arrives as a WebSocket close reason — it surfaces as a connection error whose only
 *    trace is the platform's message string. `classifyFailure` digs the status out of
 *    that string, because the alternative is reporting "connection failed" for an
 *    expired token and retrying forever (spec §15 forbids exactly that).
 */
import { MsgType, decodeEnvelope, encode, type Envelope } from '../protocol/envelope';
import { createLogger, describeError } from '../utils/logger';

const log = createLogger('socket');

/** Why the socket ended. Distinguishes "you are not allowed" from "the network broke". */
export const SocketFailure = {
  /** 401/403 before the upgrade: bad/expired token, or the role is not admin. */
  UNAUTHORIZED: 'unauthorized',
  /** The socket never opened, or dropped, for a transport reason. */
  TRANSPORT: 'transport',
  /** We closed it ourselves. Not a failure. */
  CLOSED_BY_CLIENT: 'closed_by_client',
  /** The server closed it cleanly. */
  CLOSED_BY_SERVER: 'closed_by_server',
} as const;

export type SocketFailure = (typeof SocketFailure)[keyof typeof SocketFailure];

export type DrsSocketHandlers = {
  /** The upgrade succeeded. The backend has now told the agent to start capturing. */
  onOpen?: () => void;
  /** One well-formed envelope arrived. Malformed frames never reach this. */
  onMessage?: (envelope: Envelope) => void;
  /** Terminal: the socket is gone and will not reopen on its own. */
  onClose?: (failure: SocketFailure, detail: string) => void;
};

/**
 * classifyFailure decides whether a connection error was an authorization rejection.
 *
 * React Native surfaces a failed upgrade as a platform string — Android (OkHttp) says
 * `Expected HTTP 101 response but was '401 Unauthorized'`, iOS reports the status in its
 * own wording. Neither is a stable API, so this matches on the status NUMBER, which both
 * include, and falls back to a transport failure when nothing matches. A false negative
 * here costs one wasted retry; a false positive would sign the operator out for a blip,
 * so the test is deliberately narrow.
 */
export function classifyFailure(detail: string): SocketFailure {
  if (/\b(401|403)\b/.test(detail)) {
    return SocketFailure.UNAUTHORIZED;
  }
  if (/unauthor|forbidden|admin access required/i.test(detail)) {
    return SocketFailure.UNAUTHORIZED;
  }
  return SocketFailure.TRANSPORT;
}

export class DrsSocket {
  private ws: WebSocket | null = null;
  private handlers: DrsSocketHandlers;
  private readonly url: string;
  private readonly token: string;
  /** Set once so a teardown can never be reported as a failure, or reported twice. */
  private disposed = false;
  private reported = false;
  /** The last error message seen, so `onclose` can explain a close that follows one. */
  private lastError = '';

  constructor(url: string, token: string, handlers: DrsSocketHandlers) {
    this.url = url;
    this.token = token;
    this.handlers = handlers;
  }

  /** open starts the handshake. Returns immediately; progress arrives via handlers. */
  open(): void {
    if (this.ws || this.disposed) {
      return;
    }
    log.info('opening session socket');

    // ['bearer', token]: the first value is the protocol the server negotiates, the
    // second is the credential. Order matters — bearerFromWS requires parts[0] to be
    // exactly "bearer".
    const ws = new WebSocket(this.url, ['bearer', this.token]);
    this.ws = ws;

    ws.onopen = () => {
      if (this.disposed) {
        return;
      }
      log.info('session socket open');
      this.handlers.onOpen?.();
    };

    ws.onmessage = event => {
      if (this.disposed) {
        return;
      }
      const raw = typeof event.data === 'string' ? event.data : '';
      if (!raw) {
        return;
      }
      const envelope = decodeEnvelope(raw);
      if (!envelope) {
        // The backend's own read loops skip a malformed frame rather than dropping the
        // connection; mirror that instead of tearing down a working session.
        log.warn('ignoring malformed frame');
        return;
      }
      this.handlers.onMessage?.(envelope);
    };

    ws.onerror = event => {
      // An error is informational — `onclose` always follows and is where teardown is
      // reported. Stashing the message here is the only way to explain that close,
      // since the close event itself carries no status for a failed upgrade.
      this.lastError = describeError((event as unknown as { message?: string })?.message, 'connection error');
      log.warn(`session socket error: ${this.lastError}`);
    };

    ws.onclose = event => {
      const code = (event as unknown as { code?: number })?.code ?? 0;
      const reason = (event as unknown as { reason?: string })?.reason ?? '';
      this.finish(code, reason);
    };
  }

  /** finish reports the terminal state exactly once. */
  private finish(code: number, reason: string): void {
    if (this.reported) {
      return;
    }
    this.reported = true;

    if (this.disposed) {
      this.handlers.onClose?.(SocketFailure.CLOSED_BY_CLIENT, 'closed by client');
      return;
    }

    const detail = reason || this.lastError || `socket closed (${code})`;
    // 1000 is a clean server-side close: the backend ended the session normally.
    const failure = code === 1000 ? SocketFailure.CLOSED_BY_SERVER : classifyFailure(detail);
    log.info(`session socket closed: ${failure} (${detail})`);
    this.handlers.onClose?.(failure, detail);
  }

  /** send writes one envelope. A no-op unless the socket is open. */
  send(type: MsgType, data?: unknown): boolean {
    if (!this.ws || this.ws.readyState !== 1 /* OPEN */) {
      return false;
    }
    try {
      this.ws.send(encode(type, data));
      return true;
    } catch (err) {
      log.warn(`could not send ${type}`, err);
      return false;
    }
  }

  get isOpen(): boolean {
    return this.ws?.readyState === 1;
  }

  /**
   * close tears the socket down.
   *
   * This is also how the session is STOPPED: the backend's deferred cleanup in
   * ServeSession sends `stop_session` to the agent and audits the session end when this
   * socket goes away. There is no separate stop message to send, and skipping this leaves
   * the device capturing its screen.
   */
  close(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const ws = this.ws;
    this.ws = null;
    if (!ws) {
      return;
    }
    // Detach first: a handler firing during close would otherwise re-enter finish() and
    // report a client-initiated teardown as a transport failure.
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      ws.close(1000, 'session ended');
    } catch (err) {
      log.debug('socket already closed', err);
    }
    this.finish(1000, 'closed by client');
  }
}

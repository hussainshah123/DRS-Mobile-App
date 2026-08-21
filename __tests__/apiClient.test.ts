/**
 * The revocation branch in apiFetch.
 *
 * This is the one piece of the REST client that is a decision rather than a translation, and
 * getting it wrong is invisible in the happy path: it only shows up as an operator being thrown
 * back to the login screen for typing their old password wrong on the change-password form.
 *
 * The rule the backend actually implements (internal/api/middleware.go RequireAuth): a 401 carries
 * a machine-readable `code` ONLY when a cryptographically-valid token must be rejected because the
 * account state changed. Every other 401 — wrong current password, most notably — is a plain
 * request failure that must leave the session intact.
 *
 * These tests pin both halves of that rule, because the dangerous failure mode is the permissive
 * one: treating any 401 as a revocation passes every test that only checks "does sign-out work".
 */
import {
  ApiError,
  apiFetch,
  getAuthToken,
  onSessionRevoked,
  setAuthToken,
  type RevocationCode,
} from '../src/api/client';

/** Builds the minimal shape apiFetch reads off a Response. */
function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
  };
}

function emptyResponse(status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => {
      throw new Error('not json');
    },
  };
}

let revoked: RevocationCode[];
const fetchMock = jest.fn();

beforeEach(() => {
  revoked = [];
  fetchMock.mockReset();
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  setAuthToken('jwt-abc');
  onSessionRevoked(code => revoked.push(code));
});

afterEach(() => {
  onSessionRevoked(null);
  setAuthToken(null);
});

describe('request shaping', () => {
  it('sends the bearer token and no body on a GET', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [{ id: 'd1' }]));

    await expect(apiFetch('/api/devices')).resolves.toEqual([{ id: 'd1' }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/devices$/);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer jwt-abc');
    // Content-Type must be absent, not empty: a GET with a body header trips some proxies.
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it('omits the token on a public endpoint even when one is held', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { token: 't' }));

    await apiFetch('/api/auth/login', { method: 'POST', auth: false, body: { identifier: 'a' } });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"identifier":"a"}');
  });
});

describe('a 401 that IS a revocation', () => {
  // Exactly the set RequireAuth can emit. Kept as a literal list rather than imported from the
  // client, so adding a code there cannot silently widen what this test considers acceptable.
  const codes: RevocationCode[] = [
    'account_blocked',
    'account_deleted',
    'role_changed',
    'token_invalid',
  ];

  it.each(codes)('signs the session out on %s', async code => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'nope', code }));

    await expect(apiFetch('/api/devices')).rejects.toThrow(ApiError);

    expect(revoked).toEqual([code]);
    // The in-memory token must be gone before the handler runs, or an in-flight screen can fire a
    // second authenticated request with a token already known to be dead.
    expect(getAuthToken()).toBeNull();
  });

  it('carries the code on the thrown error so a screen can explain itself', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'blocked', code: 'account_blocked' }));

    await expect(apiFetch('/api/devices')).rejects.toMatchObject({
      status: 401,
      code: 'account_blocked',
      message: 'blocked',
    });
  });
});

describe('a 401 that is NOT a revocation', () => {
  it('keeps the session when the code is absent — the wrong-current-password case', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'current password is incorrect' }));

    await expect(
      apiFetch('/api/auth/password', {
        method: 'PUT',
        body: { current_password: 'wrong', new_password: 'aaaaaaaa' },
      }),
    ).rejects.toMatchObject({ status: 401, message: 'current password is incorrect' });

    expect(revoked).toEqual([]);
    expect(getAuthToken()).toBe('jwt-abc');
  });

  it('keeps the session on an unrecognized code', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'nope', code: 'something_new' }));

    await expect(apiFetch('/api/devices')).rejects.toThrow(ApiError);

    expect(revoked).toEqual([]);
    expect(getAuthToken()).toBe('jwt-abc');
  });

  it('keeps the session when the request was unauthenticated', async () => {
    // A failed login must never present as "your session was revoked" — there was no session.
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'bad credentials', code: 'token_invalid' }));

    await expect(apiFetch('/api/auth/login', { auth: false, method: 'POST', body: {} })).rejects.toThrow(
      ApiError,
    );

    expect(revoked).toEqual([]);
    expect(getAuthToken()).toBe('jwt-abc');
  });

  it('does not revoke on a 403, even carrying a revocation code', async () => {
    // /ws/session returns 403 for a non-admin role. That is "you may not do this", not
    // "you are signed out" — signing out would strand a legitimate view-only operator.
    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'admin role required', code: 'role_changed' }));

    await expect(apiFetch('/api/devices')).rejects.toMatchObject({ status: 403 });

    expect(revoked).toEqual([]);
    expect(getAuthToken()).toBe('jwt-abc');
  });
});

describe('failures that are not HTTP errors', () => {
  it('reports an unreachable backend as status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    const err = await apiFetch('/api/devices').catch((e: ApiError) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).isNetworkError).toBe(true);
    // Never a revocation: the operator is offline, not signed out.
    expect(revoked).toEqual([]);
    expect(getAuthToken()).toBe('jwt-abc');
  });

  it('falls back to a status-derived message when the body is not JSON', async () => {
    fetchMock.mockResolvedValue(emptyResponse(502));

    await expect(apiFetch('/api/devices')).rejects.toMatchObject({
      status: 502,
      message: 'Request failed (502)',
    });
  });

  it('reports a caller-cancelled request as cancelled, not as a backend failure', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(() => {
      controller.abort();
      return Promise.reject(new Error('Aborted'));
    });

    await expect(apiFetch('/api/devices', { signal: controller.signal })).rejects.toMatchObject({
      message: 'Request cancelled',
      status: 0,
    });
  });
});

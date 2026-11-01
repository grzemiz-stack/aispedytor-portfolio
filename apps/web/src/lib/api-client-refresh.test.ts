/**
 * Token refresh: a wrong password, no session, the queue, several tabs.
 *
 * Before: a 401 from a wrong password (`/auth/login`) started a refresh with an
 * empty token → logout and a reload of `/login` — the wrong-password message
 * vanished; after a failed refresh the queued requests hung forever; two tabs
 * with the same refresh token refreshed at once, and a second use of a refresh
 * token deletes its whole family (both tabs logged out).
 * Now: `/auth/*` requests do not refresh; no refresh token, no refresh; the
 * queue gets the error; the refresh runs under `navigator.locks` (when the
 * browser has it), and under the lock the tokens are read again from
 * localStorage — when another tab already refreshed, its token is used.
 */
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

// The browser in the test: a local storage shared "between tabs" and locks.
const storage = new Map<string, string>();
(globalThis as any).window = { location: { href: '' } };
(globalThis as any).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
};
const lockCalls: string[] = [];
let lockTail = Promise.resolve();
const fakeLocks = {
  // Real lock behaviour: each call waits for the previous one.
  request: (name: string, fn: () => Promise<unknown>) => {
    lockCalls.push(name);
    const run = lockTail.then(fn);
    lockTail = run.then(() => undefined, () => undefined);
    return run;
  },
};

import { apiClient } from './api-client';
import { REFRESH_LOCK } from './api-client';
import { useAuthStore } from '@/store/auth.store';

let validAccess = 'A0';
let validRefresh = new Set<string>(['R1']);
let issued = 0;
const refreshCalls: (string | null)[] = [];
const authError = (status: number, config: any) =>
  new AxiosError(String(status), 'ERR_BAD_REQUEST', config, null, { status, statusText: '', data: { message: 'Invalid email or password' }, headers: {}, config });

function serverRefresh(token: string | null) {
  refreshCalls.push(token);
  if (!token || !validRefresh.has(token)) return Promise.reject(authError(403, {} as InternalAxiosRequestConfig));
  validRefresh.delete(token);
  issued += 1;
  validAccess = `A${issued}`;
  validRefresh.add(`R${issued + 1}`);
  return Promise.resolve({ data: { accessToken: validAccess, refreshToken: `R${issued + 1}` } });
}

/** State saved by "another tab" — the way zustand persist saves it. */
const persistOtherTab = (accessToken: string, refreshToken: string) =>
  storage.set('ai-spedytor-auth', JSON.stringify({ state: { user: { id: 'u' }, accessToken, refreshToken }, version: 0 }));

beforeEach(() => {
  validAccess = 'A0'; validRefresh = new Set(['R1']); issued = 0; refreshCalls.length = 0; lockCalls.length = 0;
  (globalThis as any).window.location.href = '';
  (globalThis as any).navigator = { locks: fakeLocks };
  storage.clear();
  useAuthStore.setState({ user: { id: 'u' } as any, accessToken: 'expired', refreshToken: 'R1' });
  jest.spyOn(axios, 'post').mockImplementation(((url: string, body: any) =>
    url.endsWith('/auth/refresh') ? serverRefresh(body.refreshToken) : Promise.reject(new Error(url))) as any);
  apiClient.defaults.adapter = (config) => {
    if (config.url?.startsWith('/auth/')) return Promise.reject(authError(401, config));
    if (config.headers.Authorization === `Bearer ${validAccess}`) {
      return Promise.resolve({ data: 'ok', status: 200, statusText: 'OK', headers: {}, config });
    }
    return Promise.reject(authError(401, config));
  };
});

afterEach(() => jest.restoreAllMocks());

describe('one tab', () => {
  it('a wrong password (401 from /auth/login): no refresh, no logout, no reload — the error reaches the login form', async () => {
    useAuthStore.setState({ user: null, accessToken: null, refreshToken: null });
    await expect(apiClient.post('/auth/login', { email: 'a@b.example.com', password: 'zle' })).rejects.toMatchObject({ response: { status: 401 } });
    expect([refreshCalls, (globalThis as any).window.location.href]).toEqual([[], '']);
  });

  it('no refresh token stored: no refresh with an empty token; logout and /login as before', async () => {
    useAuthStore.setState({ refreshToken: null });
    await expect(apiClient.get('/offers')).rejects.toBeTruthy();
    expect([refreshCalls, useAuthStore.getState().accessToken, (globalThis as any).window.location.href]).toEqual([[], null, '/login']);
  });

  it('a refused refresh: every queued request is rejected, none hangs', async () => {
    useAuthStore.setState({ refreshToken: 'stolen-or-old' });
    const results = await Promise.race([
      Promise.allSettled([apiClient.get('/offers'), apiClient.get('/vehicles'), apiClient.get('/demands')]),
      new Promise((resolve) => setTimeout(() => resolve('hang'), 1000)),
    ]);
    expect(results).not.toBe('hang');
    expect((results as PromiseSettledResult<unknown>[]).map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected']);
  });
});

describe('across tabs', () => {
  it('the refresh runs under navigator.locks with the app lock name', async () => {
    await expect(apiClient.get('/offers')).resolves.toMatchObject({ data: 'ok' });
    expect([lockCalls, refreshCalls]).toEqual([[REFRESH_LOCK], ['R1']]);
  });

  it('another tab already refreshed: under the lock the stored tokens are read again and used — no second refresh', async () => {
    // The other tab rotated R1 → R6 and saved the pair; this tab holds the old tokens in memory.
    validRefresh = new Set(['R6']);
    validAccess = 'A5';
    persistOtherTab('A5', 'R6');
    await expect(apiClient.get('/offers')).resolves.toMatchObject({ data: 'ok' });
    expect(refreshCalls).toEqual([]);
    expect(useAuthStore.getState()).toMatchObject({ accessToken: 'A5', refreshToken: 'R6' });
  });

  it('the other tab\'s access token has also expired: one real refresh with its refresh token, the request passes', async () => {
    validRefresh = new Set(['R6']);
    persistOtherTab('A5-expired', 'R6');
    await expect(apiClient.get('/offers')).resolves.toMatchObject({ data: 'ok' });
    expect(refreshCalls).toEqual(['R6']);
  });

  it('a refreshed token refused again: no second refresh, no loop', async () => {
    jest.spyOn(axios, 'post').mockImplementation((async () => ({ data: { accessToken: 'A-bad', refreshToken: 'R-next' } })) as any);
    await expect(apiClient.get('/offers')).rejects.toMatchObject({ response: { status: 401 } });
    expect((axios.post as jest.Mock).mock.calls.length).toBe(1);
  });

  it('without navigator.locks (feature detection): the refresh still works', async () => {
    (globalThis as any).navigator = {};
    await expect(apiClient.get('/offers')).resolves.toMatchObject({ data: 'ok' });
    expect([lockCalls, refreshCalls]).toEqual([[], ['R1']]);
  });

  it('two 401 at once in one tab: one refresh (the queue), both requests pass', async () => {
    const [a, b] = await Promise.all([apiClient.get('/offers'), apiClient.get('/vehicles')]);
    expect([a.data, b.data, refreshCalls]).toEqual(['ok', 'ok', ['R1']]);
  });

  it('two 401 at once without navigator.locks: still one refresh (no second use of R1)', async () => {
    (globalThis as any).navigator = {};
    const [a, b] = await Promise.all([apiClient.get('/offers'), apiClient.get('/vehicles')]);
    expect([a.data, b.data, refreshCalls]).toEqual(['ok', 'ok', ['R1']]);
  });
});

/**
 * Log out only when the server REFUSED the refresh token. Before: any refresh
 * failure — also 429 (the 5/min limit per address, shared by an office behind
 * one NAT), a network error, 5xx — logged out and reloaded `/login`. Now:
 * 429, network, 5xx → the request fails, the session stays (tokens
 * unchanged), the next request tries again.
 */
describe('logout only when the refresh is refused', () => {
  const failRefresh = (err: unknown) => jest.spyOn(axios, 'post').mockImplementation((async () => { throw err; }) as any);
  const session = () => [useAuthStore.getState().refreshToken, (globalThis as any).window.location.href];

  it.each([
    ['429 (rate limit)', () => authError(429, {} as InternalAxiosRequestConfig)],
    ['503 (server)', () => authError(503, {} as InternalAxiosRequestConfig)],
    ['a network error (no response)', () => new AxiosError('Network Error', 'ERR_NETWORK')],
  ])('%s → the request fails, the session stays, no /login', async (_n, err) => {
    failRefresh(err());
    await expect(apiClient.get('/offers')).rejects.toBeTruthy();
    expect(session()).toEqual(['R1', '']);
  });

  it.each([401, 403])('%s from /auth/refresh (refused) → logout and /login', async (status) => {
    failRefresh(authError(status, {} as InternalAxiosRequestConfig));
    await expect(apiClient.get('/offers')).rejects.toBeTruthy();
    expect(session()).toEqual([null, '/login']);
  });

  it('after a 429 the next request refreshes again and passes', async () => {
    const post = failRefresh(authError(429, {} as InternalAxiosRequestConfig));
    await expect(apiClient.get('/offers')).rejects.toBeTruthy();
    post.mockImplementation(((url: string, body: any) => serverRefresh(body.refreshToken)) as any);
    await expect(apiClient.get('/offers')).resolves.toMatchObject({ data: 'ok' });
  });
});

import axios from 'axios';
import { useAuthStore } from '@/store/auth.store';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export const apiClient = axios.create({
  baseURL: BASE_URL,
});

// Attach access token to every request
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Refresh after a 401 (apps/web/README.md, "Login and tokens").
//  - A 401 from login, registration or the refresh itself does not refresh: it
//    is a wrong e-mail/password (the message must stay on the form) or a dead
//    session.
//  - One refresh at a time in a tab: parallel 401s wait for the same promise;
//    when the refresh fails, each of them gets the error (none hangs).
//  - Across tabs: the refresh runs under `navigator.locks` (when the browser
//    has it). Under the lock the tokens are read again from localStorage — if
//    another tab already refreshed, we take its pair instead of a second
//    refresh. The server treats a second use of the same refresh token as theft
//    and deletes the whole family, which would log out every tab.
export const REFRESH_LOCK = 'ai-spedytor-token-refresh';
const AUTH_STORAGE_KEY = 'ai-spedytor-auth';
const NO_REFRESH_PATHS = ['/auth/login', '/auth/register', '/auth/refresh'];
const NO_REFRESH_TOKEN = 'no refresh token';

type Tokens = { accessToken: string | null; refreshToken: string | null };
type Refreshed = { accessToken: string; adopted: boolean };

/** Tokens saved by zustand persist — shared by all tabs. */
function storedTokens(): Tokens | null {
  try {
    const state = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) ?? 'null')?.state;
    return state ? { accessToken: state.accessToken ?? null, refreshToken: state.refreshToken ?? null } : null;
  } catch {
    return null;
  }
}

function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : undefined;
  return typeof locks?.request === 'function' ? locks.request(REFRESH_LOCK, fn) : fn();
}

/** `usedToken` — the access token the request got its 401 with. */
function refreshTokens(usedToken: string | null): Promise<Refreshed> {
  return withRefreshLock(async () => {
    const stored = storedTokens() ?? useAuthStore.getState();
    if (stored.accessToken && stored.accessToken !== usedToken && stored.refreshToken) {
      // Another tab (or an earlier refresh) already has a newer pair.
      useAuthStore.getState().setTokens(stored.accessToken, stored.refreshToken);
      return { accessToken: stored.accessToken, adopted: true };
    }
    if (!stored.refreshToken) throw new Error(NO_REFRESH_TOKEN);
    const { data } = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken: stored.refreshToken });
    // The server rotates the refresh token (auth.service.ts refresh): the old one stops working.
    useAuthStore.getState().setTokens(data.accessToken, data.refreshToken);
    return { accessToken: data.accessToken, adopted: false };
  });
}

let inflight: Promise<Refreshed> | null = null;

/**
 * The server refused the refresh (401/403) or there is no refresh token — the
 * session is over. 429 (the limit per address), 5xx and a network error are
 * not a refusal: the session stays, the next request tries again.
 */
function refreshRefused(e: unknown): boolean {
  const status = (e as { response?: { status?: number } })?.response?.status;
  if (status === 401 || status === 403) return true;
  return e instanceof Error && e.message === NO_REFRESH_TOKEN;
}

apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status !== 401 || !original || original._retry) {
      return Promise.reject(error);
    }
    if (NO_REFRESH_PATHS.some((p) => original.url?.startsWith(p))) {
      return Promise.reject(error);
    }
    const usedToken = String(original.headers?.Authorization ?? '').replace(/^Bearer /, '') || null;

    if (!inflight) {
      inflight = refreshTokens(usedToken)
        .catch((e) => {
          if (refreshRefused(e)) {
            useAuthStore.getState().logout();
            window.location.href = '/login';
          }
          throw e;
        })
        .finally(() => {
          inflight = null;
        });
    }
    let result: Refreshed;
    try {
      result = await inflight;
    } catch {
      return Promise.reject(error);
    }
    // A pair taken from another tab may have expired too — then one more try
    // (with a real refresh); after a real refresh, no more tries.
    if (!result.adopted) original._retry = true;
    else if (original._adopted) original._retry = true;
    else original._adopted = true;
    original.headers.Authorization = `Bearer ${result.accessToken}`;
    return apiClient(original);
  },
);

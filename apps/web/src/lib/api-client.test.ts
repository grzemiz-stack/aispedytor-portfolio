/**
 * Token refresh survives refresh-token rotation.
 *
 * `/auth/refresh` deletes the used refresh token and issues a new pair
 * (api/src/auth/auth.service.ts). The interceptor must store both tokens:
 * keeping only the access token sends the old refresh token on the second
 * refresh → 403 → logout (checked against the running API: a second refresh
 * with the old token = 403).
 *
 * Server stub: the protected endpoint accepts only the current access token,
 * /auth/refresh accepts a refresh token once and rotates it.
 */
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

(globalThis as any).window = { location: { href: '' } };

import { apiClient } from './api-client';
import { useAuthStore } from '@/store/auth.store';

let validAccess = '';
let validRefresh = new Set<string>();
let issued = 0;
const refreshCalls: string[] = [];

function serverRefresh(token: string) {
  refreshCalls.push(token);
  if (!validRefresh.has(token)) {
    const config = {} as InternalAxiosRequestConfig;
    return Promise.reject(new AxiosError('403', 'ERR_BAD_REQUEST', config, null,
      { status: 403, statusText: 'Forbidden', data: {}, headers: {}, config }));
  }
  validRefresh.delete(token); // rotation, as in auth.service.ts
  issued += 1;
  validAccess = `A${issued}`;
  validRefresh.add(`R${issued + 1}`);
  return Promise.resolve({ data: { accessToken: validAccess, refreshToken: `R${issued + 1}` } });
}

beforeEach(() => {
  validAccess = 'A0'; validRefresh = new Set(['R1']); issued = 0; refreshCalls.length = 0;
  (globalThis as any).window.location.href = '';
  useAuthStore.setState({ user: { id: 'u' } as any, accessToken: 'expired', refreshToken: 'R1' });
  jest.spyOn(axios, 'post').mockImplementation(((url: string, body: any) =>
    url.endsWith('/auth/refresh') ? serverRefresh(body.refreshToken) : Promise.reject(new Error(url))) as any);
  apiClient.defaults.adapter = (config) => {
    if (config.headers.Authorization === `Bearer ${validAccess}`) {
      return Promise.resolve({ data: 'ok', status: 200, statusText: 'OK', headers: {}, config });
    }
    return Promise.reject(new AxiosError('401', 'ERR_BAD_REQUEST', config, null,
      { status: 401, statusText: 'Unauthorized', data: {}, headers: {}, config }));
  };
});

afterEach(() => jest.restoreAllMocks());

it('two refreshes in a row both pass — each with the token the previous one returned', async () => {
  await expect(apiClient.get('/offers')).resolves.toMatchObject({ data: 'ok' });
  validAccess = 'expired-again'; // the access token expired after 15 min
  await expect(apiClient.get('/offers')).resolves.toMatchObject({ data: 'ok' });

  expect(refreshCalls).toEqual(['R1', 'R2']);
  expect(useAuthStore.getState()).toMatchObject({ accessToken: 'A2', refreshToken: 'R3' });
  expect((globalThis as any).window.location.href).toBe('');
});

it('a refused refresh logs out and redirects to /login', async () => {
  useAuthStore.setState({ refreshToken: 'stolen-or-old' });
  await expect(apiClient.get('/offers')).rejects.toBeTruthy();
  expect(useAuthStore.getState().accessToken).toBeNull();
  expect((globalThis as any).window.location.href).toBe('/login');
});

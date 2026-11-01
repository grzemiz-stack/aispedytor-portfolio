/**
 * The change-password form in the settings.
 *
 * Endpoint PATCH /users/me/password (api/test/unit/change-password.spec.ts).
 * The screen stores the new tokens from the response (the API ends all
 * sessions) and shows errors as sentences.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { messageText } from './plan-messages';

const src = readFileSync(resolve(__dirname, '..', 'app/(dashboard)/settings/page.tsx'), 'utf8');
const handler = src.slice(src.indexOf('async function handlePasswordChange'), src.indexOf('function handleLogoFile'));

it('calls the endpoint the API has and keeps the session with the tokens it returns', () => {
  expect(handler).toMatch(/apiClient\.patch\('\/users\/me\/password'/);
  expect(handler).toMatch(/useAuthStore\.setState\(\{ accessToken: r\.data\.accessToken, refreshToken: r\.data\.refreshToken \}\)/);
});

it('checks the 8-character minimum before sending and shows API errors as sentences', () => {
  expect(handler).toMatch(/newPassword\.length < 8/);
  expect(handler).toMatch(/setError\(errorText\(err\.response\?\.data, /);
  expect(messageText({ code: 'PASSWORD_CURRENT_INVALID' })).toBe('Obecne hasło jest nieprawidłowe.');
  expect(messageText({ code: 'PASSWORD_UNCHANGED' }, 'en')).toBe('The new password is the same as the current one.');
});

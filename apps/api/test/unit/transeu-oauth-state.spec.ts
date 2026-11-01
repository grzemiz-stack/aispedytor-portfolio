/**
 * Trans.eu OAuth — `state` signed with HMAC, with a single-use nonce and an
 * expiry.
 *
 * The attack this prevents: the callback does not require login, so an
 * unsigned `state` such as plain base64({companyId, ts}) could be built by
 * anyone who knows another company's id, linking THEIR Trans.eu account to
 * that company.
 */
import { BadRequestException } from '@nestjs/common';
import { TransEuAuthService } from '../../src/trans-eu-auth/trans-eu-auth.service';
import { TransEuAuthController } from '../../src/trans-eu-auth/trans-eu-auth.controller';
import { signState, verifyState, STATE_TTL_MS } from '../../src/trans-eu-auth/oauth-state';
import { EncryptionService } from '../../src/common/encryption/encryption.service';

const SECRET = 's'.repeat(48);
const T0 = Date.UTC(2030, 0, 1, 12);

beforeEach(() => {
  process.env.JWT_SECRET = SECRET;
  process.env.TRANS_EU_CLIENT_ID = 'client';
  process.env.TRANS_EU_CLIENT_SECRET = 'client-secret';
});

function service(now = T0) {
  const prisma: any = { exchangeConnection: { upsert: jest.fn() } };
  const enc = new EncryptionService({ get: () => 'ab'.repeat(32) } as any);
  const svc = new TransEuAuthService(prisma, enc);
  svc.now = () => now;
  return { svc, prisma };
}

/**
 * The state from the URL the service generated — as the browser gets it —
 * and the binding that browser got in the cookie.
 */
function issued(svc: TransEuAuthService, companyId = 'comp-1') {
  const { url, binding } = svc.startAuthorization(companyId, 'https://api.example/cb');
  return { state: new URL(url).searchParams.get('state')!, binding };
}

describe('signed state', () => {
  it('valid state verifies and carries the company', () => {
    const r = verifyState(signState('comp-1', T0, SECRET, 'n1'), T0, SECRET);
    expect(r).toEqual({ ok: true, payload: { companyId: 'comp-1', nonce: 'n1', exp: T0 + STATE_TTL_MS } });
  });

  it('the old unsigned format (base64 JSON with someone else’s companyId) → rejected', () => {
    const forged = Buffer.from(JSON.stringify({ companyId: 'victim', ts: T0 })).toString('base64url');
    expect(verifyState(forged, T0, SECRET)).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('companyId swapped inside a valid state → bad signature', () => {
    const [, mac] = signState('comp-1', T0, SECRET, 'n1').split('.');
    const body = Buffer.from(JSON.stringify({ companyId: 'victim', nonce: 'n1', exp: T0 + STATE_TTL_MS })).toString('base64url');
    expect(verifyState(`${body}.${mac}`, T0, SECRET)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('signed with another secret → bad signature', () => {
    expect(verifyState(signState('comp-1', T0, 'x'.repeat(48)), T0, SECRET)).toMatchObject({ reason: 'BAD_SIGNATURE' });
  });

  it('after 10 minutes → expired; exactly at the limit → still valid', () => {
    const s = signState('comp-1', T0, SECRET);
    expect(verifyState(s, T0 + STATE_TTL_MS, SECRET).ok).toBe(true);
    expect(verifyState(s, T0 + STATE_TTL_MS + 1, SECRET)).toMatchObject({ reason: 'EXPIRED' });
  });
});

describe('callback consumes the state once', () => {
  it('state issued by the service → the company, once; a second use → 400', () => {
    const { svc } = service();
    const { state, binding } = issued(svc);
    expect(svc.consumeState(state, binding)).toBe('comp-1');
    expect(() => svc.consumeState(state, binding)).toThrow(/USED_OR_UNKNOWN/);
  });

  it('validly signed but never issued here (e.g. after a restart) → 400', () => {
    const { svc } = service();
    expect(() => svc.consumeState(signState('comp-1', T0, SECRET), 'any')).toThrow(/USED_OR_UNKNOWN/);
  });

  it('expired → 400, even if issued', () => {
    const { svc } = service();
    const { state, binding } = issued(svc);
    svc.now = () => T0 + STATE_TTL_MS + 1;
    expect(() => svc.consumeState(state, binding)).toThrow(/EXPIRED/);
  });

  it('forged state → handleCallback stops before talking to Trans.eu or saving anything', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any);
    const { svc, prisma } = service();
    const forged = Buffer.from(JSON.stringify({ companyId: 'victim', ts: T0 })).toString('base64url');
    await expect(svc.handleCallback('code', forged, 'https://api.example/cb', 'any')).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.exchangeConnection.upsert).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

/**
 * `state` bound to the browser that started connecting. A signed `state`
 * alone was enough: an ADMIN of company A sent the Trans.eu login link to
 * someone from company B; they logged in with THEIR Trans.eu account, and the
 * callback (no JWT) linked B's account to company A. Now `connect` gives the
 * browser a random binding in an HttpOnly cookie (Path = callback,
 * SameSite=Lax, 10 min), and the server keeps only its hash next to the nonce.
 * A callback without that cookie or with another → 400 BROWSER_MISMATCH, nonce
 * used up.
 */
describe('state bound to the browser that started connecting', () => {
  it('a forwarded link opened in another browser (another or no cookie) → 400, nonce burnt, nothing sent or saved', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any);
    const { svc, prisma } = service();
    const { state, binding } = issued(svc);
    await expect(svc.handleCallback('code', state, 'https://api.example/cb', 'other-browser')).rejects.toThrow(/BROWSER_MISMATCH/);
    // The same state cannot be used again — not even with the right cookie.
    expect(() => svc.consumeState(state, binding)).toThrow(/USED_OR_UNKNOWN/);
    expect([fetchSpy.mock.calls.length, prisma.exchangeConnection.upsert.mock.calls.length]).toEqual([0, 0]);
    fetchSpy.mockRestore();
  });

  it.each([undefined, ''])('no cookie (%p) → 400 BROWSER_MISMATCH', (cookie) => {
    const { svc } = service();
    const { state } = issued(svc);
    expect(() => svc.consumeState(state, cookie)).toThrow(/BROWSER_MISMATCH/);
  });

  it('two connects: each state works only with its own cookie', () => {
    const { svc } = service();
    const a = issued(svc, 'comp-1');
    const b = issued(svc, 'comp-1');
    expect(a.binding).not.toBe(b.binding);
    expect(() => svc.consumeState(a.state, b.binding)).toThrow(/BROWSER_MISMATCH/);
    expect(svc.consumeState(b.state, b.binding)).toBe('comp-1');
  });

  it('the binding is not in the URL and not in the state', () => {
    const { svc } = service();
    const { url, binding } = svc.startAuthorization('comp-1', 'https://api.example/cb');
    expect(binding.length).toBeGreaterThanOrEqual(43);
    expect(decodeURIComponent(url)).not.toContain(binding);
  });
});

describe('controller: the cookie', () => {
  const user: any = { userId: 'u-1', companyId: 'comp-1', role: 'ADMIN' };

  it.each([
    ['https://api.example', true],
    ['http://localhost:3001', false],
  ])('connect (API_BASE_URL=%s) sets the binding cookie: HttpOnly, SameSite=Lax, callback path, 10 min, Secure=%s; then redirects', (base, secure) => {
    process.env.API_BASE_URL = base;
    const svc: any = { startAuthorization: jest.fn(() => ({ url: 'https://auth.example/authorize?x', binding: 'B1' })) };
    const res: any = { cookie: jest.fn(), redirect: jest.fn() };
    new TransEuAuthController(svc).connect(user, res);
    expect(res.cookie).toHaveBeenCalledWith('transeu_oauth', 'B1', { httpOnly: true, sameSite: 'lax', path: '/api/integrations/transeu/callback', maxAge: STATE_TTL_MS, secure });
    expect(res.redirect).toHaveBeenCalledWith('https://auth.example/authorize?x');
    expect(res.cookie.mock.invocationCallOrder[0]).toBeLessThan(res.redirect.mock.invocationCallOrder[0]);
  });

  it('callback passes the cookie from the request to the service and clears it', async () => {
    process.env.API_BASE_URL = 'https://api.example';
    const svc: any = { handleCallback: jest.fn(async () => ({ companyId: 'comp-1' })) };
    const res: any = { clearCookie: jest.fn(), redirect: jest.fn() };
    const req: any = { headers: { cookie: 'a=1; old_transeu_oauth=X; transeu_oauth=B1; b=2' } };
    await new TransEuAuthController(svc).callback('code', 'st', undefined as any, req, res);
    expect(svc.handleCallback).toHaveBeenCalledWith('code', 'st', 'https://api.example/api/integrations/transeu/callback', 'B1');
    expect(res.clearCookie).toHaveBeenCalledWith('transeu_oauth', { path: '/api/integrations/transeu/callback' });
  });

  it('callback clears the cookie also when the state is refused', async () => {
    const svc: any = { handleCallback: jest.fn(async () => { throw new BadRequestException('BROWSER_MISMATCH'); }) };
    const res: any = { clearCookie: jest.fn(), redirect: jest.fn() };
    await expect(new TransEuAuthController(svc).callback('code', 'st', undefined as any, { headers: {} } as any, res)).rejects.toThrow(/BROWSER_MISMATCH/);
    expect(svc.handleCallback.mock.calls[0][3]).toBeUndefined();
    expect(res.clearCookie).toHaveBeenCalled();
  });
});

describe('callback error from Trans.eu', () => {
  it('the reason is URL-encoded in the redirect, not pasted', async () => {
    const ctrl = new TransEuAuthController({} as any);
    const res: any = { redirect: jest.fn(), clearCookie: jest.fn() };
    await ctrl.callback(undefined as any, undefined as any, 'x&transeu=connected<script>', { headers: {} } as any, res);
    const url: string = res.redirect.mock.calls[0][0];
    expect(new URL(url).searchParams.get('transeu')).toBe('error');
    expect(new URL(url).searchParams.get('reason')).toBe('x&transeu=connected<script>');
    expect(url).not.toContain('<script>');
  });
});

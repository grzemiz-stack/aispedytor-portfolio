import { Injectable, Logger, OnModuleInit, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { requireJwtSecret } from '../common/config/secrets';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { signState, verifyState, STATE_TTL_MS } from './oauth-state';

/** The Trans.eu OAuth token answer (the fields we store). */
interface TransEuTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  scope?: string;
}

const TRANS_EU_AUTH_URL = 'https://auth.system.trans.eu/oauth2';

export interface TransEuTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
}

/**
 * Ciphertext format of `EncryptionService.encrypt`: iv(12 B):tag(16 B):data, hex.
 * A Trans.eu OAuth token does not look like this — that is how rows stored
 * before encryption was introduced are recognised.
 */
const ENCRYPTED = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]*$/;
export const isEncryptedToken = (v: string) => ENCRYPTED.test(v);

/** SHA-256 of the binding — a fixed length, so the `timingSafeEqual` comparison is safe. */
const hashBinding = (binding: string): Buffer => createHash('sha256').update(binding).digest();

@Injectable()
export class TransEuAuthService implements OnModuleInit {
  private readonly logger = new Logger(TransEuAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly enc: EncryptionService,
  ) {}

  /**
   * Tokens are stored encrypted, so that whoever reads the database or a copy
   * of it cannot act on the company's Trans.eu account. Existing rows are
   * migrated on module start: every token that is not in ciphertext format is
   * encrypted and saved — idempotently (SQL cannot do this: the database does
   * not know the key).
   */
  async onModuleInit(): Promise<void> {
    const n = await this.encryptLegacyTokens();
    if (n > 0) this.logger.log(`Encrypted Trans.eu tokens in ${n} connections (migration)`);
  }

  async encryptLegacyTokens(): Promise<number> {
    const rows = await this.prisma.exchangeConnection.findMany({
      select: { id: true, accessToken: true, refreshToken: true },
    });
    let changed = 0;
    for (const r of rows) {
      if (isEncryptedToken(r.accessToken) && isEncryptedToken(r.refreshToken)) continue;
      await this.prisma.exchangeConnection.update({
        where: { id: r.id },
        data: { accessToken: this.seal(r.accessToken), refreshToken: this.seal(r.refreshToken) },
      });
      changed++;
    }
    return changed;
  }

  /** Encrypts unless already encrypted (the migration may meet a half-rewritten row). */
  private seal(token: string): string {
    return isEncryptedToken(token) ? token : this.enc.encrypt(token);
  }

  /** Decrypts; a row from before the migration (plain text) is read as is — the migration rewrites it on module start. */
  private open(token: string): string {
    return isEncryptedToken(token) ? this.enc.decrypt(token) : token;
  }

  /** Clock as a field — tests set "now". */
  now: () => number = () => Date.now();

  /**
   * Issued, not yet used nonces → expiry time and the hash of the browser
   * binding. Kept in process memory: works
   * with a single API instance; after a restart a login in progress has to be
   * started again (the safe side: an unknown nonce is rejected).
   */
  private readonly pendingNonces = new Map<string, { exp: number; bindingHash: Buffer }>();

  private secret(): string {
    return requireJwtSecret(process.env.JWT_SECRET);
  }

  private prune(now: number): void {
    for (const [nonce, p] of this.pendingNonces) if (p.exp < now) this.pendingNonces.delete(nonce);
  }

  // ── STEP 1: build the Trans.eu login URL ───────────────────────────────────
  /**
   * The Trans.eu login URL and the browser binding.
   *
   * A signed `state` alone did not say WHO finishes the login: a link passed
   * on to someone from another company linked their Trans.eu account to the
   * sender's company. `binding` (32 random bytes) goes to the browser in an
   * HttpOnly cookie (controller); the server keeps only its hash next to the
   * nonce; the callback must bring the same cookie. It is neither in the URL
   * nor in `state`. Meant for a "Connect to Trans.eu" button (the web app has
   * none yet).
   */
  startAuthorization(companyId: string, redirectUri: string): { url: string; binding: string } {
    const clientId = process.env.TRANS_EU_CLIENT_ID;
    if (!clientId) throw new BadRequestException('TRANS_EU_CLIENT_ID nie skonfigurowany');

    const now = this.now();
    this.prune(now);
    const state = signState(companyId, now, this.secret());
    const check = verifyState(state, now, this.secret());
    const binding = randomBytes(32).toString('base64url');
    if (check.ok) this.pendingNonces.set(check.payload.nonce, { exp: now + STATE_TTL_MS, bindingHash: hashBinding(binding) });
    const params = new URLSearchParams({
      client_id:     clientId,
      response_type: 'code',
      redirect_uri:  redirectUri,
      scope:         'offers.loads.manage offers.vehicles.manage',
      state,
    });

    const url = `${TRANS_EU_AUTH_URL}/authorize?${params.toString()}`;
    this.logger.log(`Auth URL generated for company ${companyId}`);
    return { url, binding };
  }

  // ── STEP 2: exchange the code for tokens (callback after login) ────────────
  async handleCallback(code: string, state: string, redirectUri: string, binding: string | undefined): Promise<{ companyId: string }> {
    const clientId     = process.env.TRANS_EU_CLIENT_ID;
    const clientSecret = process.env.TRANS_EU_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new BadRequestException('Trans.eu nie skonfigurowany');

    // state: signature, expiry, single-use nonce and the same browser are checked first — only then is companyId trusted.
    const companyId = this.consumeState(state, binding);

    // Exchange the code for an access_token
    const body = new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id:    clientId,
      client_secret: clientSecret,
    });

    const response = await fetch(`${TRANS_EU_AUTH_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const err = await response.text();
      this.logger.error(`Token exchange failed: ${err}`);
      throw new UnauthorizedException('Blad logowania Trans.eu — sprawdz dane konta');
    }

    const data = (await response.json()) as TransEuTokenResponse;
    await this.saveTokens(companyId, data);
    this.logger.log(`Trans.eu connected for company ${companyId}`);
    return { companyId };
  }

  /**
   * Checks `state`, consumes its nonce and compares the binding from the
   * browser's cookie. Any failure = 400, nothing is saved. The nonce is used
   * up also for the wrong browser — a forwarded link cannot be retried.
   */
  consumeState(state: unknown, binding: string | undefined): string {
    const now = this.now();
    const check = verifyState(state, now, this.secret());
    if (check.ok === false) throw new BadRequestException(`Nieprawidlowy state (${check.reason})`);
    this.prune(now);
    const pending = this.pendingNonces.get(check.payload.nonce);
    if (!pending) throw new BadRequestException('Nieprawidlowy state (USED_OR_UNKNOWN)');
    this.pendingNonces.delete(check.payload.nonce);
    if (!binding || !timingSafeEqual(pending.bindingHash, hashBinding(binding))) {
      throw new BadRequestException('Nieprawidlowy state (BROWSER_MISMATCH)');
    }
    return check.payload.companyId;
  }

  // ── STEP 3: a valid access token (refreshed if under 60 s left) ────────────
  async getValidAccessToken(companyId: string): Promise<string> {
    const conn = await this.prisma.exchangeConnection.findUnique({
      where: { companyId_exchange: { companyId, exchange: 'TRANS_EU' } },
    });

    if (!conn) throw new UnauthorizedException('Firma nie jest polaczona z Trans.eu');

    // Token valid for more than 60 s — return it
    if (conn.accessTokenExpiresAt > new Date(Date.now() + 60_000)) {
      return this.open(conn.accessToken);
    }

    // Token expired or about to — refresh it
    this.logger.log(`Refreshing Trans.eu token for company ${companyId}`);
    return this.refreshToken(companyId, this.open(conn.refreshToken));
  }

  // ── Refresh the token ──────────────────────────────────────────────────────
  private async refreshToken(companyId: string, refreshToken: string): Promise<string> {
    const clientId     = process.env.TRANS_EU_CLIENT_ID;
    const clientSecret = process.env.TRANS_EU_CLIENT_SECRET;

    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     clientId!,
      client_secret: clientSecret!,
    });

    const response = await fetch(`${TRANS_EU_AUTH_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      // Refresh failed (e.g. the refresh token, 60 days, has expired) — mark EXPIRED; the account must be connected again
      await this.prisma.exchangeConnection.update({
        where: { companyId_exchange: { companyId, exchange: 'TRANS_EU' } },
        data: { status: 'EXPIRED' },
      });
      throw new UnauthorizedException('Sesja Trans.eu wygasla — wymagane ponowne polaczenie');
    }

    const data = (await response.json()) as TransEuTokenResponse;
    await this.saveTokens(companyId, data);
    return data.access_token;
  }

  // ── Save the tokens in the database ────────────────────────────────────────
  private async saveTokens(companyId: string, data: TransEuTokenResponse): Promise<void> {
    const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000);
    await this.prisma.exchangeConnection.upsert({
      where: { companyId_exchange: { companyId, exchange: 'TRANS_EU' } },
      create: {
        companyId,
        exchange: 'TRANS_EU',
        accessToken: this.enc.encrypt(data.access_token),
        refreshToken: this.enc.encrypt(data.refresh_token),
        accessTokenExpiresAt: expiresAt,
        scope: data.scope ?? '',
        status: 'ACTIVE',
      },
      update: {
        accessToken: this.enc.encrypt(data.access_token),
        refreshToken: this.enc.encrypt(data.refresh_token),
        accessTokenExpiresAt: expiresAt,
        scope: data.scope ?? '',
        status: 'ACTIVE',
      },
    });
  }

  // ── Connection status ──────────────────────────────────────────────────────
  async getConnectionStatus(companyId: string) {
    const conn = await this.prisma.exchangeConnection.findUnique({
      where: { companyId_exchange: { companyId, exchange: 'TRANS_EU' } },
    });
    if (!conn) return { connected: false, exchange: 'TRANS_EU' };
    return {
      connected: conn.status === 'ACTIVE',
      exchange: 'TRANS_EU',
      status: conn.status,
      expiresAt: conn.accessTokenExpiresAt,
      scope: conn.scope,
    };
  }

  // ── Disconnect ─────────────────────────────────────────────────────────────
  async disconnect(companyId: string): Promise<void> {
    await this.prisma.exchangeConnection.deleteMany({
      where: { companyId, exchange: 'TRANS_EU' },
    });
    this.logger.log(`Trans.eu disconnected for company ${companyId}`);
  }
}

import { Controller, Get, Query, Req, Res, UseGuards, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { TransEuAuthService } from './trans-eu-auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtUser } from '../common/types/authenticated-request';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { STATE_TTL_MS } from './oauth-state';

/**
 * The cookie that binds `state` to the browser: HttpOnly (the page's scripts
 * cannot read it), SameSite=Lax (sent on the redirect back from Trans.eu, not
 * on background requests from other sites), only on the callback path, 10 min
 * like `state`; Secure when the API is served over https.
 */
const BINDING_COOKIE = 'transeu_oauth';
const CALLBACK_PATH = '/api/integrations/transeu/callback';

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

@ApiTags('trans-eu-auth')
@Controller('integrations/transeu')
export class TransEuAuthController {
  constructor(private readonly service: TransEuAuthService) {}

  // Step 1: redirect the user to the Trans.eu login page
  @Get('connect')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Start linking a Trans.eu account (ADMIN only; redirects to the Trans.eu OAuth login). Sets a cookie that binds state to this browser — the callback must come from it' })
  connect(@CurrentUser() user: JwtUser, @Res() res: Response) {
    const base = process.env.API_BASE_URL ?? '';
    const { url, binding } = this.service.startAuthorization(user.companyId, `${base}${CALLBACK_PATH}`);
    res.cookie(BINDING_COOKIE, binding, { httpOnly: true, sameSite: 'lax', path: CALLBACK_PATH, maxAge: STATE_TTL_MS, secure: base.startsWith('https://') });
    return res.redirect(url);
  }

  // Step 2: Trans.eu redirects back here after login
  @Get('callback')
  @ApiOperation({ summary: 'OAuth callback from Trans.eu (not for manual calls); redirects to the web app /settings, an invalid state returns 400' })
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // The cookie is single-use like `state` — cleared on every outcome.
    const binding = readCookie(req.headers.cookie, BINDING_COOKIE);
    res.clearCookie(BINDING_COOKIE, { path: CALLBACK_PATH });
    if (error) {
      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
      // `error` comes from outside — it is URL-encoded, never pasted into the URL.
      return res.redirect(`${frontendUrl}/settings?transeu=error&reason=${encodeURIComponent(error)}`);
    }

    const redirectUri = `${process.env.API_BASE_URL}${CALLBACK_PATH}`;
    await this.service.handleCallback(code, state, redirectUri, binding);

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    return res.redirect(`${frontendUrl}/settings?transeu=connected`);
  }

  // Connection status
  @Get('status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Trans.eu connection status of the caller's company" })
  status(@CurrentUser() user: JwtUser) {
    return this.service.getConnectionStatus(user.companyId);
  }

  // Disconnect
  @Delete('disconnect')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Disconnect the Trans.eu account (ADMIN only; deletes the stored tokens)' })
  async disconnect(@CurrentUser() user: JwtUser) {
    await this.service.disconnect(user.companyId);
    return { success: true, message: 'Trans.eu odlaczone' };
  }
}

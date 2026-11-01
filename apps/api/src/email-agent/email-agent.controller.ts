import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EmailAgentService } from './email-agent.service';
import { ProcessEmailDto, SimulateEmailDto } from './dto/process-email.dto';
import { UpdateEmailDto } from './dto/update-email.dto';
import { InboxQueryDto } from './dto/inbox-query.dto';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

/**
 * E-mails someone sent to the application (the test panel or `POST /process`).
 * The application does NOT connect to a mailbox — a mailbox connector (IMAP, Gmail)
 * is out of the product's scope. "Inbox" in the paths is the list of saved e-mails.
 */
@ApiTags('email-agent')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Throttle({ default: { ttl: 60000, limit: 20 } })
@Controller('email-agent')
export class EmailAgentController {
  constructor(private readonly emailAgentService: EmailAgentService) {}

  @Post('process')
  @ApiOperation({
    summary: 'Accept an e-mail sent through the API — classify it (LLM, or the rule-based classifier as a fallback) and save it',
    description: 'The only way an e-mail gets into the app (the test panel in the web app saves through it too). The app does not read a mailbox (no IMAP/Gmail — out of scope).',
  })
  @ApiResponse({ status: 201, description: '`{ email, classification }` — the saved e-mail and the classification result' })
  @ApiResponse({ status: 400, description: 'Validation of `ProcessEmailDto`: `subject` and `body` non-empty text, `fromEmail` and `toEmail` valid e-mail addresses; optional `fromName`, `receivedAt` (ISO date), `messageId`; a field outside the schema, or malformed JSON, is refused too.' })
  processEmail(@Body() dto: ProcessEmailDto, @Req() req: AuthenticatedRequest) {
    return this.emailAgentService.processEmail(dto, req.user.companyId);
  }

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Classify an e-mail without saving it (the check step of the test panel)' })
  @ApiResponse({ status: 200, description: '`{ classification }` — the classification result' })
  simulate(@Body() dto: SimulateEmailDto) {
    return this.emailAgentService.simulateClassification(dto);
  }

  @Get('inbox')
  @ApiOperation({ summary: 'E-mails saved in the app, with filters (category, unread only, starred, search) — not a mailbox' })
  @ApiResponse({ status: 200, description: 'Paginated list (`{ data, meta }`), unread first, then newest. `offset` is a page number (from 1); `limit` defaults to 20, at most 100.' })
  getInbox(@Req() req: AuthenticatedRequest, @Query() filters: InboxQueryDto) {
    return this.emailAgentService.getInbox(req.user.companyId, filters);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Statistics of the e-mails saved in the app (total, unread, by category, by priority, OFFER e-mails without a created offer)' })
  @ApiResponse({ status: 200, description: '`{ total, unread, offersToReview, byCategory, byPriority }`' })
  getStats(@Req() req: AuthenticatedRequest) {
    return this.emailAgentService.getStats(req.user.companyId);
  }

  @Get(':emailId')
  @ApiOperation({ summary: 'E-mail details' })
  @ApiResponse({ status: 200, description: 'The full e-mail record' })
  @ApiResponse({ status: 404, description: 'E-mail not found (or it belongs to another company)' })
  getEmail(@Param('emailId') emailId: string, @Req() req: AuthenticatedRequest) {
    return this.emailAgentService.getEmail(emailId, req.user.companyId);
  }

  @Post(':emailId/create-offer')
  @ApiOperation({ summary: 'Create an offer from the data extracted from the e-mail (400 EMAIL_OFFER_FIELDS_MISSING when a required field is missing; 409 EMAIL_OFFER_EXISTS when an offer from this e-mail already exists)' })
  @ApiResponse({ status: 201, description: '`{ offer, email }` — the created offer and the e-mail record as read before the link was set' })
  @ApiResponse({ status: 404, description: 'E-mail not found (or it belongs to another company)' })
  createOffer(@Param('emailId') emailId: string, @Req() req: AuthenticatedRequest) {
    return this.emailAgentService.createOfferFromEmail(emailId, req.user.companyId);
  }

  @Patch(':emailId')
  @ApiOperation({ summary: 'Update the notes and/or tags of an e-mail' })
  @ApiResponse({ status: 200, description: 'The updated e-mail' })
  @ApiResponse({ status: 404, description: 'E-mail not found (or it belongs to another company)' })
  updateEmail(
    @Param('emailId') emailId: string,
    @Body() dto: UpdateEmailDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.emailAgentService.updateEmail(emailId, req.user.companyId, dto);
  }

  @Patch(':emailId/read')
  @ApiOperation({ summary: 'Mark an e-mail as read' })
  @ApiResponse({ status: 200, description: 'The e-mail, marked as read' })
  @ApiResponse({ status: 404, description: 'E-mail not found (or it belongs to another company)' })
  markRead(@Param('emailId') emailId: string, @Req() req: AuthenticatedRequest) {
    return this.emailAgentService.markRead(emailId, req.user.companyId);
  }

  @Patch(':emailId/star')
  @ApiOperation({ summary: 'Toggle the star on an e-mail' })
  @ApiResponse({ status: 200, description: 'The e-mail with the star toggled' })
  @ApiResponse({ status: 404, description: 'E-mail not found (or it belongs to another company)' })
  toggleStar(@Param('emailId') emailId: string, @Req() req: AuthenticatedRequest) {
    return this.emailAgentService.toggleStar(emailId, req.user.companyId);
  }
}

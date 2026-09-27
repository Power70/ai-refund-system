import { Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { LoginRateLimit } from '../common/rate-limit/login-rate-limit.decorator.js';
import { CurrentCustomerId } from './current-customer-id.decorator.js';
import { CustomerAuthGuard } from './customer-auth.guard.js';
import { CustomerSessionService, SESSION_NOT_FOUND } from './customer-session.service.js';
import { SessionResponseDto } from './dto/session-response.dto.js';
import { StartSessionDto } from './dto/start-session.dto.js';
import { SESSION_COOKIE, sessionCookieOptions } from './session-cookie.js';

@ApiTags('customer session')
@Controller('customer/session')
export class CustomerSessionController {
  constructor(private readonly sessions: CustomerSessionService) {}

  /** Sign in with email + order number; sets the HttpOnly session cookie. */
  @Post()
  @HttpCode(HttpStatus.OK)
  @LoginRateLimit()
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiNotFoundResponse({ description: SESSION_NOT_FOUND })
  @ApiTooManyRequestsResponse()
  async start(@Body() body: StartSessionDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SessionResponseDto> {
    const session = await this.sessions.start(body.email, body.orderNumber);
    res.cookie(SESSION_COOKIE, session.token, sessionCookieOptions(req.secure));
    return { firstName: session.firstName, expiresAt: session.expiresAt.toISOString() };
  }

  /** Who is signed in (lets the app restore a session after a page refresh). */
  @Get()
  @UseGuards(CustomerAuthGuard)
  @ApiCookieAuth(SESSION_COOKIE)
  @ApiOkResponse({ description: 'Signed in', schema: { properties: { firstName: { type: 'string' } } } })
  @ApiUnauthorizedResponse()
  async current(@CurrentCustomerId() customerId: string): Promise<{ firstName: string }> {
    const customer = await this.sessions.describe(customerId);
    if (!customer) throw new NotFoundException(SESSION_NOT_FOUND);
    return customer;
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Signed out' })
  end(@Req() req: Request, @Res({ passthrough: true }) res: Response): void {
    const { maxAge: _ignored, ...options } = sessionCookieOptions(req.secure);
    res.clearCookie(SESSION_COOKIE, options);
  }
}

import { Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, NotFoundException, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { LoginRateLimit } from '../common/rate-limit.js';
import { AuthService, SIGN_IN_FAILED, TOO_MANY_ATTEMPTS } from './auth.service.js';
import { CurrentCustomerId } from './decorators/current-customer.decorator.js';
import { AdminSessionResponseDto, CurrentCustomerDto, SessionResponseDto, StartAdminSessionDto, StartSessionDto } from './dto/auth.dto.js';
import { AdminAuthGuard } from './guards/admin-auth.guard.js';
import { CustomerAuthGuard } from './guards/customer-auth.guard.js';
import { ADMIN_COOKIE_PATH, ADMIN_SESSION_COOKIE, SESSION_COOKIE, sessionCookieOptions } from './session-token.js';

@ApiTags('customer session')
@Controller('customer/session')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Signs in with email + order number and sets the session cookie. */
  @Post()
  @HttpCode(HttpStatus.OK)
  @LoginRateLimit()
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiNotFoundResponse({ description: SIGN_IN_FAILED })
  @ApiTooManyRequestsResponse()
  async signIn(@Body() body: StartSessionDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SessionResponseDto> {
    const session = await this.auth.signIn(body.email, body.orderNumber);
    res.cookie(SESSION_COOKIE, session.token, sessionCookieOptions(req.secure, undefined, session.expiresAt));
    return { firstName: session.firstName, expiresAt: session.expiresAt.toISOString() };
  }

  /** The signed-in customer, so the app can restore a session after a refresh. */
  @Get()
  @UseGuards(CustomerAuthGuard)
  @ApiCookieAuth(SESSION_COOKIE)
  @ApiOkResponse({ type: CurrentCustomerDto })
  @ApiUnauthorizedResponse()
  async current(@CurrentCustomerId() customerId: string): Promise<CurrentCustomerDto> {
    const customer = await this.auth.describeCustomer(customerId);
    if (!customer) throw new NotFoundException(SIGN_IN_FAILED);
    return customer;
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Signed out' })
  signOut(@Req() req: Request, @Res({ passthrough: true }) res: Response): void {
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(req.secure));
  }
}

/** The support dashboard's session: the admin token is exchanged once for an httpOnly cookie. */
@ApiTags('admin session')
@Controller('admin/session')
export class AdminSessionController {
  constructor(private readonly auth: AuthService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AdminSessionResponseDto })
  @ApiUnauthorizedResponse()
  @ApiTooManyRequestsResponse({ description: 'Too many wrong tokens from this IP' })
  signIn(@Body() body: StartAdminSessionDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): AdminSessionResponseDto {
    const { result, session } = this.auth.startAdminSession(body.token, String(req.ip));
    if (result === 'locked') throw new HttpException(TOO_MANY_ATTEMPTS, HttpStatus.TOO_MANY_REQUESTS);
    if (!session) throw new UnauthorizedException('That token was not accepted.');
    res.cookie(ADMIN_SESSION_COOKIE, session.token, sessionCookieOptions(req.secure, ADMIN_COOKIE_PATH, session.expiresAt));
    return { expiresAt: session.expiresAt.toISOString() };
  }

  /** 204 while the session is valid, so the dashboard can restore it after a reload. */
  @Get()
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminAuthGuard)
  @ApiCookieAuth(ADMIN_SESSION_COOKIE)
  @ApiBearerAuth()
  @ApiNoContentResponse({ description: 'Signed in' })
  @ApiUnauthorizedResponse()
  current(): void {}

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Signed out' })
  signOut(@Req() req: Request, @Res({ passthrough: true }) res: Response): void {
    res.clearCookie(ADMIN_SESSION_COOKIE, sessionCookieOptions(req.secure, ADMIN_COOKIE_PATH));
  }
}

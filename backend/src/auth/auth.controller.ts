import { Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { LoginRateLimit } from '../common/rate-limit.js';
import { AuthService, SIGN_IN_FAILED } from './auth.service.js';
import { CurrentCustomerId } from './decorators/current-customer.decorator.js';
import { CurrentCustomerDto, SessionResponseDto, StartSessionDto } from './dto/auth.dto.js';
import { CustomerAuthGuard } from './guards/customer-auth.guard.js';
import { SESSION_COOKIE, sessionCookieOptions } from './session-token.js';

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
    res.cookie(SESSION_COOKIE, session.token, sessionCookieOptions(req.secure));
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
    const { maxAge: _ignored, ...options } = sessionCookieOptions(req.secure);
    res.clearCookie(SESSION_COOKIE, options);
  }
}

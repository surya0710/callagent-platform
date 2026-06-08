import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import {
  AUTH_COOKIE_NAME,
  clearAuthCookie,
  setAuthCookie,
} from './auth-cookie.util';
import { AuthService } from './auth.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterAdminDto } from './dto/register-admin.dto';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  private isCookieSecure() {
    const explicitValue = this.configService.get<string>('AUTH_COOKIE_SECURE');

    if (explicitValue !== undefined) {
      return explicitValue === 'true';
    }

    return this.configService.get<string>('NODE_ENV') === 'production';
  }

  @Public()
  @Post('register-admin')
  @ApiOperation({ summary: 'Register the first admin user' })
  async registerAdmin(
    @Body() dto: RegisterAdminDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.registerAdmin(dto, req.ip);
    setAuthCookie(res, result.accessToken, result.cookieMaxAgeMs, this.isCookieSecure());
    return { user: result.user };
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Login with email and password' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.login(dto, req.ip);
    setAuthCookie(res, result.accessToken, result.cookieMaxAgeMs, this.isCookieSecure());
    return { user: result.user };
  }

  @Public()
  @Post('logout')
  @ApiOperation({ summary: 'Logout and clear auth cookie' })
  logout(@Res({ passthrough: true }) res: Response) {
    clearAuthCookie(res, this.isCookieSecure());
    return { message: 'Logged out successfully' };
  }

  @Get('me')
  @ApiCookieAuth(AUTH_COOKIE_NAME)
  @ApiOperation({ summary: 'Get current authenticated user' })
  getMe(@CurrentUser() user: AuthenticatedUser): Promise<AuthenticatedUser> {
    return this.authService.getCurrentUser(user.id);
  }
}

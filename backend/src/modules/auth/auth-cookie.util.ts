import { CookieOptions, Response } from 'express';

export const AUTH_COOKIE_NAME = 'ai_voice_access_token';

export function getAuthCookieOptions(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: undefined,
  };
}

export function setAuthCookie(
  res: Response,
  token: string,
  maxAgeMs: number,
  isProduction: boolean,
) {
  res.cookie(AUTH_COOKIE_NAME, token, {
    ...getAuthCookieOptions(isProduction),
    maxAge: maxAgeMs,
  });
}

export function clearAuthCookie(res: Response, isProduction: boolean) {
  res.clearCookie(AUTH_COOKIE_NAME, getAuthCookieOptions(isProduction));
}

export function parseExpiresInToMs(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match) {
    return 24 * 60 * 60 * 1000;
  }

  const value = Number(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      return 24 * 60 * 60 * 1000;
  }
}

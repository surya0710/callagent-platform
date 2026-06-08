import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RbacService } from '../rbac/rbac.service';
import { parseExpiresInToMs } from './auth-cookie.util';
import { LoginDto } from './dto/login.dto';
import { RegisterAdminDto } from './dto/register-admin.dto';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';

export interface AuthSessionResult {
  user: AuthenticatedUser;
  accessToken: string;
  cookieMaxAgeMs: number;
}

@Injectable()
export class AuthService {
  private readonly saltRounds = 12;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly rbacService: RbacService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async registerAdmin(dto: RegisterAdminDto, ipAddress?: string) {
    const userCount = await this.prisma.user.count();

    if (userCount > 0) {
      throw new ConflictException(
        'Admin registration is only allowed when no users exist',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);
    const adminRole = await this.rbacService.getRoleByName('admin');

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        roles: {
          create: [{ roleId: adminRole.id }],
        },
      },
    });

    await this.auditLogsService.log({
      userId: user.id,
      action: 'create',
      entityType: 'user',
      entityId: user.id,
      metadata: { event: 'register_admin' },
      ipAddress,
    });

    const authUser = await this.buildAuthenticatedUser(user.id);
    return this.buildAuthResponse(authUser);
  }

  async login(dto: LoginDto, ipAddress?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.auditLogsService.log({
      userId: user.id,
      action: 'login',
      entityType: 'user',
      entityId: user.id,
      ipAddress,
    });

    const authUser = await this.buildAuthenticatedUser(user.id);
    return this.buildAuthResponse(authUser);
  }

  async getCurrentUser(userId: string): Promise<AuthenticatedUser> {
    return this.buildAuthenticatedUser(userId);
  }

  private async buildAuthenticatedUser(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid or inactive user');
    }

    const roles = user.roles.map((ur) => ur.role.name);
    const permissions = [
      ...new Set(
        user.roles.flatMap((ur) =>
          ur.role.permissions.map((rp) => rp.permission.name),
        ),
      ),
    ];

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles,
      permissions,
    };
  }

  private buildAuthResponse(user: AuthenticatedUser): AuthSessionResult {
    const payload = { sub: user.id, email: user.email };
    const accessToken = this.jwtService.sign(payload);
    const expiresIn = this.configService.getOrThrow<string>('JWT_EXPIRES_IN');

    return {
      user,
      accessToken,
      cookieMaxAgeMs: parseExpiresInToMs(expiresIn),
    };
  }
}

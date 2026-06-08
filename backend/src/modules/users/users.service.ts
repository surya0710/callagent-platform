import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RbacService } from '../rbac/rbac.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

@Injectable()
export class UsersService {
  private readonly saltRounds = 12;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rbacService: RbacService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async findAll(query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where = query.search
      ? {
          OR: [
            { email: { contains: query.search } },
            { firstName: { contains: query.search } },
            { lastName: { contains: query.search } },
          ],
        }
      : undefined;

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          roles: {
            include: { role: true },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        roles: {
          include: { role: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async create(dto: CreateUserDto, actorId: string) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
      },
    });

    if (dto.role) {
      await this.rbacService.assignRoleToUser(user.id, dto.role);
    }

    await this.auditLogsService.log({
      userId: actorId,
      action: 'create',
      entityType: 'user',
      entityId: user.id,
    });

    return this.findOne(user.id);
  }

  async update(id: string, dto: UpdateUserDto, actorId: string) {
    await this.findOne(id);

    if (dto.email) {
      const existing = await this.prisma.user.findFirst({
        where: {
          email: dto.email.toLowerCase(),
          NOT: { id },
        },
      });

      if (existing) {
        throw new ConflictException('Email already in use');
      }
    }

    const data: {
      email?: string;
      passwordHash?: string;
      firstName?: string;
      lastName?: string;
    } = {};

    if (dto.email) data.email = dto.email.toLowerCase();
    if (dto.firstName) data.firstName = dto.firstName;
    if (dto.lastName) data.lastName = dto.lastName;
    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, this.saltRounds);
    }

    await this.prisma.user.update({ where: { id }, data });

    if (dto.role) {
      await this.prisma.userRole.deleteMany({ where: { userId: id } });
      await this.rbacService.assignRoleToUser(id, dto.role);
    }

    await this.auditLogsService.log({
      userId: actorId,
      action: 'update',
      entityType: 'user',
      entityId: id,
    });

    return this.findOne(id);
  }

  async disable(id: string, actorId: string) {
    await this.findOne(id);

    await this.prisma.user.update({
      where: { id },
      data: { status: 'disabled' },
    });

    await this.auditLogsService.log({
      userId: actorId,
      action: 'deactivate',
      entityType: 'user',
      entityId: id,
    });

    return this.findOne(id);
  }
}

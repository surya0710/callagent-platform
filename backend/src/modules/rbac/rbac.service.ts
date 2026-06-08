import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  async getRoleByName(name: string) {
    const role = await this.prisma.role.findUnique({ where: { name } });

    if (!role) {
      throw new NotFoundException(`Role "${name}" not found. Run database seed.`);
    }

    return role;
  }

  async listRoles() {
    return this.prisma.role.findMany({
      include: {
        permissions: {
          include: { permission: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async listPermissions() {
    return this.prisma.permission.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async assignRoleToUser(userId: string, roleName: string) {
    const role = await this.getRoleByName(roleName);

    await this.prisma.userRole.upsert({
      where: {
        userId_roleId: { userId, roleId: role.id },
      },
      update: {},
      create: { userId, roleId: role.id },
    });

    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          include: { role: true },
        },
      },
    });
  }
}

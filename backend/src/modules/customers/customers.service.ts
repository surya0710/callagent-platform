import { Injectable, NotFoundException } from '@nestjs/common';
import { CustomerStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { ImportCustomersDto } from './dto/import-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async findAll(query: CustomerQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search } },
              { lastName: { contains: query.search } },
              { phone: { contains: query.search } },
              { email: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return customer;
  }

  async create(dto: CreateCustomerDto, userId: string) {
    const customer = await this.prisma.customer.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        email: dto.email,
        language: dto.language ?? 'en',
        timezone: dto.timezone ?? 'UTC',
        metadata: dto.metadata as Prisma.InputJsonValue,
        status: dto.status ?? CustomerStatus.active,
      },
    });

    await this.auditLogsService.log({
      userId,
      action: 'create',
      entityType: 'customer',
      entityId: customer.id,
    });

    return customer;
  }

  async update(id: string, dto: UpdateCustomerDto, userId: string) {
    await this.findOne(id);

    const customer = await this.prisma.customer.update({
      where: { id },
      data: {
        ...dto,
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
      },
    });

    await this.auditLogsService.log({
      userId,
      action: 'update',
      entityType: 'customer',
      entityId: id,
    });

    return customer;
  }

  async softDelete(id: string, userId: string) {
    await this.findOne(id);

    const customer = await this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date(), status: CustomerStatus.inactive },
    });

    await this.auditLogsService.log({
      userId,
      action: 'delete',
      entityType: 'customer',
      entityId: id,
    });

    return customer;
  }

  async importCsv(dto: ImportCustomersDto, userId: string) {
    const lines = dto.csv.trim().split(/\r?\n/);
    const header = lines.shift()?.split(',').map((h) => h.trim()) ?? [];

    const required = ['firstName', 'lastName', 'phone'];
    const missing = required.filter((col) => !header.includes(col));

    if (missing.length > 0) {
      return {
        imported: 0,
        skipped: 0,
        errors: [`Missing required columns: ${missing.join(', ')}`],
      };
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;

      const values = line.split(',').map((v) => v.trim());
      const row: Record<string, string> = {};
      header.forEach((col, i) => {
        row[col] = values[i] ?? '';
      });

      if (!row.firstName || !row.lastName || !row.phone) {
        skipped++;
        errors.push(`Row ${index + 2}: missing required fields`);
        continue;
      }

      try {
        await this.prisma.customer.create({
          data: {
            firstName: row.firstName,
            lastName: row.lastName,
            phone: row.phone,
            email: row.email || undefined,
            language: row.language || 'en',
            timezone: row.timezone || 'UTC',
          },
        });
        imported++;
      } catch {
        skipped++;
        errors.push(`Row ${index + 2}: failed to import`);
      }
    }

    await this.auditLogsService.log({
      userId,
      action: 'import',
      entityType: 'customer',
      metadata: { imported, skipped, errorCount: errors.length },
    });

    return { imported, skipped, errors };
  }

  async getCallHistory(id: string) {
    await this.findOne(id);

    return this.prisma.call.findMany({
      where: { customerId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        summary: true,
        campaign: { select: { id: true, name: true } },
      },
    });
  }
}

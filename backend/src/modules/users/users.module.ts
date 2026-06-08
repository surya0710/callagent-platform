import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RbacModule } from '../rbac/rbac.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [RbacModule, AuditLogsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

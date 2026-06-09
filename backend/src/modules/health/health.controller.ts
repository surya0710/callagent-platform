import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Basic health check' })
  getHealth() {
    return this.healthService.getHealth();
  }

  @Public()
  @Get('db')
  @ApiOperation({ summary: 'Database health check' })
  checkDatabase() {
    return this.healthService.checkDatabase();
  }

  @Public()
  @Get('redis')
  @ApiOperation({ summary: 'Redis health check' })
  checkRedis() {
    return this.healthService.checkRedis();
  }

  @Public()
  @Get('sentry')
  @ApiOperation({ summary: 'Sentry integration status (no secrets)' })
  getSentryStatus() {
    return this.healthService.getSentryStatus();
  }

  @Public()
  @Get('sentry-test')
  @ApiOperation({ summary: 'Trigger a Sentry test error (non-production only)' })
  sentryTest() {
    return this.healthService.sentryTest();
  }
}

import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/constants/permissions';
import { AnalyticsService } from './analytics.service';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
  @ApiOperation({ summary: 'Dashboard overview metrics' })
  getOverview() {
    return this.analyticsService.getOverview();
  }

  @Get('campaigns/:id')
  @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
  @ApiOperation({ summary: 'Campaign-specific analytics' })
  getCampaignAnalytics(@Param('id') id: string) {
    return this.analyticsService.getCampaignAnalytics(id);
  }

  @Get('calls')
  @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
  @ApiOperation({ summary: 'Call analytics' })
  getCallAnalytics() {
    return this.analyticsService.getCallAnalytics();
  }

  @Get('sentiment')
  @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
  @ApiOperation({ summary: 'Sentiment analytics' })
  getSentimentAnalytics() {
    return this.analyticsService.getSentimentAnalytics();
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../../common/constants/permissions';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CampaignsService } from './campaigns.service';
import { AddCustomersDto } from './dto/add-customers.dto';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { ScheduleCampaignDto } from './dto/schedule-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

@ApiTags('Campaigns')
@ApiBearerAuth()
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CAMPAIGNS_READ)
  @ApiOperation({ summary: 'List campaigns' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.campaignsService.findAll(query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CAMPAIGNS_WRITE)
  @ApiOperation({ summary: 'Create campaign' })
  create(
    @Body() dto: CreateCampaignDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.campaignsService.create(dto, user.id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CAMPAIGNS_READ)
  @ApiOperation({ summary: 'Get campaign by ID' })
  findOne(@Param('id') id: string) {
    return this.campaignsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CAMPAIGNS_WRITE)
  @ApiOperation({ summary: 'Update campaign' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.campaignsService.update(id, dto, user.id);
  }

  @Post(':id/customers')
  @RequirePermissions(PERMISSIONS.CAMPAIGNS_WRITE)
  @ApiOperation({ summary: 'Add customers to campaign' })
  addCustomers(
    @Param('id') id: string,
    @Body() dto: AddCustomersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.campaignsService.addCustomers(id, dto, user.id);
  }

  @Post(':id/schedule')
  @RequirePermissions(PERMISSIONS.CAMPAIGNS_WRITE)
  @ApiOperation({ summary: 'Schedule campaign' })
  schedule(
    @Param('id') id: string,
    @Body() dto: ScheduleCampaignDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.campaignsService.schedule(id, dto, user.id);
  }

  @Post(':id/pause')
  @RequirePermissions(PERMISSIONS.CAMPAIGNS_WRITE)
  @ApiOperation({ summary: 'Pause campaign' })
  pause(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.campaignsService.pause(id, user.id);
  }

  @Post(':id/resume')
  @RequirePermissions(PERMISSIONS.CAMPAIGNS_WRITE)
  @ApiOperation({ summary: 'Resume campaign' })
  resume(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.campaignsService.resume(id, user.id);
  }

  @Post(':id/retry-failed')
  @RequirePermissions(PERMISSIONS.CAMPAIGNS_WRITE)
  @ApiOperation({ summary: 'Retry failed calls in campaign' })
  retryFailed(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.campaignsService.retryFailed(id, user.id);
  }
}

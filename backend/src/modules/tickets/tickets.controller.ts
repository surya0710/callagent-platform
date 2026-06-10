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
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { TicketQueryDto } from './dto/ticket-query.dto';
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto';
import { TicketsService } from './tickets.service';

@ApiTags('Tickets')
@ApiBearerAuth()
@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TICKETS_READ)
  @ApiOperation({ summary: 'List tickets' })
  findAll(@Query() query: TicketQueryDto) {
    return this.ticketsService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TICKETS_READ)
  @ApiOperation({ summary: 'Get ticket by ID' })
  findOne(@Param('id') id: string) {
    return this.ticketsService.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TICKETS_WRITE)
  @ApiOperation({ summary: 'Create ticket' })
  create(
    @Body() dto: CreateTicketDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ticketsService.create(dto, user.id);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.TICKETS_WRITE)
  @ApiOperation({ summary: 'Update ticket status' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTicketStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ticketsService.updateStatus(id, dto.status, user.id);
  }
}

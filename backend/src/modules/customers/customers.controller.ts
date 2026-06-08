import {
  Body,
  Controller,
  Delete,
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
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { ImportCustomersDto } from './dto/import-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMERS_READ)
  @ApiOperation({ summary: 'List customers with pagination and filters' })
  findAll(@Query() query: CustomerQueryDto) {
    return this.customersService.findAll(query);
  }

  @Post('import')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_WRITE)
  @ApiOperation({ summary: 'Import customers from CSV text' })
  importCsv(
    @Body() dto: ImportCustomersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customersService.importCsv(dto, user.id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMERS_WRITE)
  @ApiOperation({ summary: 'Create customer' })
  create(
    @Body() dto: CreateCustomerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customersService.create(dto, user.id);
  }

  @Get(':id/calls')
  @RequirePermissions(PERMISSIONS.CALLS_READ)
  @ApiOperation({ summary: 'Get customer call history' })
  getCallHistory(@Param('id') id: string) {
    return this.customersService.getCallHistory(id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_READ)
  @ApiOperation({ summary: 'Get customer by ID' })
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_WRITE)
  @ApiOperation({ summary: 'Update customer' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customersService.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_WRITE)
  @ApiOperation({ summary: 'Soft delete customer' })
  remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customersService.softDelete(id, user.id);
  }
}

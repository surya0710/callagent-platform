import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TicketSource } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTicketDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  customerId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  callId?: string;

  @ApiProperty({ example: 'driver_behavior' })
  @IsString()
  @IsNotEmpty()
  issueCategory!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  issueSummary?: string;

  @ApiPropertyOptional({ enum: ['low', 'medium', 'high', 'critical'], default: 'medium' })
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiPropertyOptional({ enum: TicketSource, default: TicketSource.manual })
  @IsOptional()
  @IsEnum(TicketSource)
  source?: TicketSource;
}

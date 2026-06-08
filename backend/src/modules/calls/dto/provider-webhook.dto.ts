import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CallStatus } from '@prisma/client';
import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';

export class ProviderWebhookDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  providerRef?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  callId?: string;

  @ApiPropertyOptional({ enum: CallStatus })
  @IsOptional()
  @IsEnum(CallStatus)
  status?: CallStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

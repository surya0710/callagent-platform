import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiKeyWebhookConfigDto } from './api-key-webhook-config.dto';

export class UpdateApiKeyDto extends ApiKeyWebhookConfigDto {
  @ApiPropertyOptional({
    example: 'Driver Service Production',
    description: 'Application or client name these credentials are for',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({
    description: 'Set to true to remove the stored webhook auth token',
  })
  @IsOptional()
  @IsBoolean()
  clearWebhookAuthToken?: boolean;
}

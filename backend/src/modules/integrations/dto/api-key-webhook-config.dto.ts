import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUrl, MaxLength, ValidateIf } from 'class-validator';

export enum ApiKeyWebhookAuthTypeDto {
  none = 'none',
  bearer = 'bearer',
  header = 'header',
}

export class ApiKeyWebhookConfigDto {
  @ApiPropertyOptional({
    example: 'https://your-driver-app.com/webhooks/voice',
    description:
      'Webhook URL for call status updates and post-call recording + transcript delivery',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  webhookUrl?: string;

  @ApiPropertyOptional({
    enum: ApiKeyWebhookAuthTypeDto,
    description: 'Authentication sent when POSTing to your webhook URL',
    default: ApiKeyWebhookAuthTypeDto.none,
  })
  @IsOptional()
  @IsEnum(ApiKeyWebhookAuthTypeDto)
  webhookAuthType?: ApiKeyWebhookAuthTypeDto;

  @ApiPropertyOptional({
    example: 'X-API-Key',
    description: 'Custom header name when webhookAuthType is header',
  })
  @ValidateIf((dto) => dto.webhookAuthType === ApiKeyWebhookAuthTypeDto.header)
  @IsOptional()
  @IsString()
  @MaxLength(191)
  webhookAuthHeaderName?: string;

  @ApiPropertyOptional({
    example: 'your-secret-token',
    description: 'Bearer token or header value sent to your webhook URL',
  })
  @ValidateIf(
    (dto) =>
      dto.webhookAuthType === ApiKeyWebhookAuthTypeDto.bearer ||
      dto.webhookAuthType === ApiKeyWebhookAuthTypeDto.header,
  )
  @IsOptional()
  @IsString()
  @MaxLength(512)
  webhookAuthToken?: string;
}

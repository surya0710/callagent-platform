import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { ApiKeyWebhookConfigDto } from './api-key-webhook-config.dto';

export class CreateApiKeyDto extends ApiKeyWebhookConfigDto {
  @ApiProperty({
    example: 'Driver Service Production',
    description: 'Application or client name these credentials are for',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;
}

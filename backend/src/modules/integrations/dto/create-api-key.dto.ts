import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Driver Service Production' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({
    example: 'https://your-driver-app.com/webhooks/voice',
    description:
      'Default webhook URL for call status updates and post-call recording + transcript delivery',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  webhookUrl?: string;
}

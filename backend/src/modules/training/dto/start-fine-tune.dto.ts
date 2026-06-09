import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class StartFineTuneDto {
  @ApiPropertyOptional({
    description: 'Fine-tunable base model. Defaults to OPENAI_FINE_TUNE_MODEL.',
    example: 'gpt-4.1-mini-2025-04-14',
  })
  @IsOptional()
  @IsString()
  baseModel?: string;

  @ApiPropertyOptional({ example: 'voice-calls-june' })
  @IsOptional()
  @IsString()
  suffix?: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class AiTestResponseDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}

export class AiSummarizeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  transcript!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class AiSentimentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  text!: string;
}

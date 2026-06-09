import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreateTrainingDatasetDto {
  @ApiProperty({ example: 'June sales call training set' })
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Use specific approved recording IDs. If omitted, all approved recordings are used.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  recordingIds?: string[];

  @ApiPropertyOptional({
    description: 'System message included in every JSONL training example.',
  })
  @IsOptional()
  @IsString()
  systemPrompt?: string;
}

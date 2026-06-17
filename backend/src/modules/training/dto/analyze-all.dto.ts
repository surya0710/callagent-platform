import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class AnalyzeAllDto {
  @ApiPropertyOptional({
    description: 'Specific recording IDs to analyze. If omitted, all transcribed recordings are analyzed.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  recordingIds?: string[];
}

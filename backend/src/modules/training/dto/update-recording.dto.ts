import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateRecordingDto {
  @ApiPropertyOptional({ example: 'hi' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ example: 'interested' })
  @IsOptional()
  @IsString()
  labelOutcome?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  transcript?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  redactedTranscript?: string;

  @ApiPropertyOptional({
    description: 'Clear transcript and allow re-transcription',
  })
  @IsOptional()
  @IsBoolean()
  resetTranscription?: boolean;
}

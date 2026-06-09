import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UploadRecordingDto {
  @ApiPropertyOptional({ description: 'Existing call ID to link this recording to' })
  @IsOptional()
  @IsString()
  callId?: string;

  @ApiPropertyOptional({ example: 'en' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ example: 'interested' })
  @IsOptional()
  @IsString()
  labelOutcome?: string;
}

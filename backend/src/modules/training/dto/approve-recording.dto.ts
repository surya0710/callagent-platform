import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ApproveRecordingDto {
  @ApiProperty({ example: 'interested' })
  @IsString()
  @IsNotEmpty()
  labelOutcome!: string;

  @ApiProperty({
    description: 'The ideal assistant output this call should teach the fine-tuned model.',
  })
  @IsString()
  @IsNotEmpty()
  expectedResponse!: string;

  @ApiPropertyOptional({
    description: 'Optional reviewed/redacted transcript override.',
  })
  @IsOptional()
  @IsString()
  redactedTranscript?: string;
}

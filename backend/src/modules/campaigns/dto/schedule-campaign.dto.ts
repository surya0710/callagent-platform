import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';

export class ScheduleCampaignDto {
  @ApiPropertyOptional({ description: 'ISO datetime; defaults to now if omitted' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledAt?: Date;
}

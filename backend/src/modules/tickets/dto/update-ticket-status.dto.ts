import { ApiProperty } from '@nestjs/swagger';
import { TicketStatus } from '@prisma/client';
import { IsEnum, IsNotEmpty } from 'class-validator';

export class UpdateTicketStatusDto {
  @ApiProperty({ enum: TicketStatus })
  @IsEnum(TicketStatus)
  @IsNotEmpty()
  status!: TicketStatus;
}

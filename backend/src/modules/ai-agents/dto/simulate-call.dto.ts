import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ConversationTurnDto } from './conversation-turn.dto';

export class SimulateCallDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  customerId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tripId?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  userMessage!: string;

  @ApiProperty({ type: [ConversationTurnDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConversationTurnDto)
  conversationHistory!: ConversationTurnDto[];
}

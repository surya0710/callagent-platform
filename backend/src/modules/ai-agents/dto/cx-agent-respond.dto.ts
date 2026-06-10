import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ConversationTurnDto } from './conversation-turn.dto';

export class CxAgentRespondDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  customerId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  userMessage!: string;

  @ApiProperty({ type: [ConversationTurnDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConversationTurnDto)
  conversationHistory!: ConversationTurnDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  callId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tripId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  customerContext?: Record<string, unknown>;
}

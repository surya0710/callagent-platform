import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class KnowledgeRetrievalDto {
  @ApiProperty({ example: 'customer_experience' })
  @IsString()
  @IsNotEmpty()
  department!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  conversationText!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  issueCategory?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  customerContext?: Record<string, unknown>;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateConversationExampleDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({ example: 'customer_experience' })
  @IsString()
  @IsNotEmpty()
  department!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  transcript!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  goodPractices?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  badPractices?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

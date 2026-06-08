import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Driver Service Production' })
  @IsString()
  @IsNotEmpty()
  name!: string;
}

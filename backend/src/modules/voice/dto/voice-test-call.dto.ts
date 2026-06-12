import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VoiceTestCallDto {
  @ApiProperty({
    example: '9876543210',
    description: '10-digit Indian mobile number or 91XXXXXXXXXX',
  })
  @IsString()
  @IsNotEmpty()
  customerNumber!: string;
}

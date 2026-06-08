import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ImportCustomersDto {
  @ApiProperty({
    description: 'CSV content with headers: firstName,lastName,phone,email,language,timezone',
    example: 'firstName,lastName,phone,email\nJohn,Doe,+15551234567,john@example.com',
  })
  @IsString()
  @IsNotEmpty()
  csv!: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { VoiceCallContextDto } from './voice-call-context.dto';

export class VoiceTestCallDto {
  @ApiProperty({
    example: '9876543210',
    description: '10-digit Indian mobile number or 91XXXXXXXXXX',
  })
  @IsString()
  @IsNotEmpty()
  customerNumber!: string;

  @ApiPropertyOptional({
    description:
      'Optional booking/customer details injected into the AI runtime for this call. All fields are optional.',
    example: {
      bookingNumber: 'OD482917',
      customerName: 'Rahul Sharma',
      customerNumber: '9876543210',
      driverName: 'Rajesh Kumar',
      driverMobileNumber: '9999999999',
      totalCharges: 450,
      balanceAmount: 150,
      paymentMode: 'UPI',
    },
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => VoiceCallContextDto)
  callContext?: VoiceCallContextDto;
}

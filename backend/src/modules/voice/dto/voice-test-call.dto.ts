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
      bookingNumber: 'BK1234',
      customerName: 'Rahul Sharma',
      customerNumber: '9876543210',
      driverName: 'Ramesh',
      driverMobileNumber: '9999999999',
      productType: 'cab',
      city: 'Delhi',
      zone: 'South Delhi',
      package: '4 hours 40 km',
      endTime: '2026-06-23T18:30:00+05:30',
      totalCharges: 2500,
      balanceAmount: 850,
      paymentMode: 'cash',
      runningKms: 52,
      overtimeMinutes: 20,
      overtimeCharges: 200,
    },
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => VoiceCallContextDto)
  callContext?: VoiceCallContextDto;
}

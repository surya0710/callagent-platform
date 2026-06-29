import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from 'class-validator';
import { VoiceCallContextDto } from '../../voice/dto/voice-call-context.dto';

export class OnDemandCallDto {
  @ApiProperty({
    description: 'Unique booking/reference ID from your application (idempotency key)',
    example: 'OD482917',
  })
  @IsString()
  @IsNotEmpty()
  externalRef!: string;

  @ApiProperty({
    example: '9876543210',
    description: '10-digit Indian mobile number or 91XXXXXXXXXX',
  })
  @IsString()
  @IsNotEmpty()
  customerNumber!: string;

  @ApiPropertyOptional({
    description:
      'Booking/customer details injected into the AI voice runtime for this call. All fields are optional.',
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

  @ApiPropertyOptional({
    description:
      'Optional per-call webhook URL override. When omitted, the API key default webhookUrl is used for status and result delivery.',
    example: 'https://your-driver-app.com/webhooks/voice-status',
  })
  @IsOptional()
  @IsUrl()
  webhookUrl?: string;

  @ApiPropertyOptional({
    deprecated: true,
    description: 'Deprecated alias for webhookUrl.',
    example: 'https://your-driver-app.com/webhooks/voice-status',
  })
  @IsOptional()
  @IsUrl()
  callbackUrl?: string;

  @ApiPropertyOptional({
    description: 'Optional opaque metadata stored on the call record',
    example: { fleetId: 'fleet_delhi_01' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

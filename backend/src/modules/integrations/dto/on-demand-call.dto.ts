import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CallPurpose } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from 'class-validator';

export class IntegrationPassengerDto {
  @ApiProperty({ example: '+15551234567' })
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @ApiProperty({ example: 'Alex' })
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @ApiPropertyOptional({ example: 'Rivera' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ default: 'en' })
  @IsOptional()
  @IsString()
  language?: string;
}

export class IntegrationDriverDto {
  @ApiPropertyOptional({ example: 'Sam Taylor' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: '+15559876543' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'VH-204' })
  @IsOptional()
  @IsString()
  vehicleId?: string;

  @ApiPropertyOptional({ example: 'ABC-1234' })
  @IsOptional()
  @IsString()
  vehiclePlate?: string;
}

export class IntegrationTripDto {
  @ApiPropertyOptional({ example: '123 Main St, Austin, TX' })
  @IsOptional()
  @IsString()
  pickupAddress?: string;

  @ApiPropertyOptional({ example: '456 Oak Ave, Austin, TX' })
  @IsOptional()
  @IsString()
  dropoffAddress?: string;

  @ApiPropertyOptional({ example: '2026-06-08T18:30:00Z' })
  @IsOptional()
  @IsString()
  scheduledPickupAt?: string;

  @ApiPropertyOptional({ example: '2026-06-08T18:45:00Z' })
  @IsOptional()
  @IsString()
  estimatedArrival?: string;

  @ApiPropertyOptional({ example: '24.50' })
  @IsOptional()
  @IsString()
  fare?: string;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;
}

export class OnDemandCallDto {
  @ApiProperty({
    description: 'Unique trip/booking reference from your application',
    example: 'trip_9f3a21',
  })
  @IsString()
  @IsNotEmpty()
  externalRef!: string;

  @ApiProperty({ type: IntegrationPassengerDto })
  @ValidateNested()
  @Type(() => IntegrationPassengerDto)
  passenger!: IntegrationPassengerDto;

  @ApiPropertyOptional({ type: IntegrationDriverDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => IntegrationDriverDto)
  driver?: IntegrationDriverDto;

  @ApiPropertyOptional({ type: IntegrationTripDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => IntegrationTripDto)
  trip?: IntegrationTripDto;

  @ApiProperty({
    enum: CallPurpose,
    example: CallPurpose.driver_assigned,
  })
  @IsEnum(CallPurpose)
  callPurpose!: CallPurpose;

  @ApiPropertyOptional({ enum: ['normal', 'high'], default: 'normal' })
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiPropertyOptional({
    description: 'URL to receive call status webhooks',
    example: 'https://driver-app.example.com/webhooks/voice',
  })
  @IsOptional()
  @IsUrl()
  callbackUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

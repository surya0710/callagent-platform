import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class VoiceCallContextDto {
  @ApiPropertyOptional({ example: 'OD482917' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trimString)
  bookingNumber?: string;

  @ApiPropertyOptional({ example: 'Rahul Sharma' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trimString)
  customerName?: string;

  @ApiPropertyOptional({ example: '9876543210' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trimString)
  customerNumber?: string;

  @ApiPropertyOptional({ example: 'Rajesh Kumar' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trimString)
  driverName?: string;

  @ApiPropertyOptional({ example: '9999999999' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trimString)
  driverMobileNumber?: string;

  @ApiPropertyOptional({ example: 450 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000)
  totalCharges?: number;

  @ApiPropertyOptional({ example: 150 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000)
  balanceAmount?: number;

  @ApiPropertyOptional({ example: 'UPI' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trimString)
  paymentMode?: string;
}

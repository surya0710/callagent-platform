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
  @ApiPropertyOptional({ example: 'BK1234' })
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

  @ApiPropertyOptional({ example: 'Ramesh' })
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

  @ApiPropertyOptional({ example: 'cab' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trimString)
  productType?: string;

  @ApiPropertyOptional({ example: 'Delhi' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trimString)
  city?: string;

  @ApiPropertyOptional({ example: 'South Delhi' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trimString)
  zone?: string;

  @ApiPropertyOptional({ example: '4 hours 40 km' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trimString)
  package?: string;

  @ApiPropertyOptional({ example: '2026-06-23T18:30:00+05:30' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trimString)
  endTime?: string;

  @ApiPropertyOptional({ example: 2500 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000)
  totalCharges?: number;

  @ApiPropertyOptional({ example: 850 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000)
  balanceAmount?: number;

  @ApiPropertyOptional({ example: 'cash' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trimString)
  paymentMode?: string;

  @ApiPropertyOptional({ example: 52 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  runningKms?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100_000)
  overtimeMinutes?: number;

  @ApiPropertyOptional({ example: 200 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000)
  overtimeCharges?: number;
}

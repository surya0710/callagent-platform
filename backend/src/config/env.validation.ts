import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum AiProviderType {
  OPENAI = 'openai',
  BEDROCK = 'bedrock',
  MOCK = 'mock',
}

export enum VoiceRuntimeType {
  MOCK = 'mock',
  OPENAI_REALTIME = 'openai-realtime',
}

export enum VoiceRecordingStorageDriver {
  LOCAL = 'local',
  S3 = 's3',
}

export class EnvironmentVariables {
  @IsEnum(['development', 'production', 'test'])
  NODE_ENV!: 'development' | 'production' | 'test';

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  REDIS_HOST!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT!: number;

  @IsString()
  @IsNotEmpty()
  JWT_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  JWT_EXPIRES_IN!: string;

  @IsOptional()
  @IsString()
  AUTH_COOKIE_SECURE?: string;

  @IsEnum(AiProviderType)
  AI_PROVIDER!: AiProviderType;

  @IsOptional()
  @IsString()
  OPENAI_API_KEY?: string;

  @IsOptional()
  @IsString()
  OPENAI_MODEL?: string;

  @IsOptional()
  @IsString()
  OPENAI_TRANSCRIPTION_MODEL?: string;

  @IsOptional()
  @IsString()
  OPENAI_FINE_TUNE_MODEL?: string;

  @IsOptional()
  @IsString()
  OPENAI_REALTIME_MODEL?: string;

  @IsOptional()
  @IsString()
  OPENAI_REALTIME_VOICE?: string;

  @IsOptional()
  @IsString()
  OPENAI_REALTIME_INSTRUCTIONS?: string;

  @IsOptional()
  @IsString()
  AWS_REGION?: string;

  @IsOptional()
  @IsString()
  BEDROCK_MODEL_ID?: string;

  @IsString()
  @IsNotEmpty()
  CORS_ORIGIN!: string;

  @IsOptional()
  @IsString()
  REDIS_ENABLED?: string;

  @IsOptional()
  @IsString()
  SEED_DEV_INTEGRATION_API_KEY?: string;

  @IsOptional()
  @IsString()
  SENTRY_ENABLED?: string;

  @IsOptional()
  @IsString()
  SENTRY_DSN?: string;

  @IsOptional()
  @IsString()
  SENTRY_ENVIRONMENT?: string;

  @IsOptional()
  @IsString()
  SENTRY_TRACES_SAMPLE_RATE?: string;

  @IsOptional()
  @IsString()
  SENTRY_TEST_ENABLED?: string;

  @IsOptional()
  @IsString()
  APP_VERSION?: string;

  @IsOptional()
  @IsEnum(VoiceRuntimeType)
  VOICE_RUNTIME?: VoiceRuntimeType;

  @IsOptional()
  @IsString()
  VOICE_WSS_BASE_URL?: string;

  @IsOptional()
  @IsEnum(VoiceRecordingStorageDriver)
  VOICE_RECORDINGS_STORAGE_DRIVER?: VoiceRecordingStorageDriver;

  @IsOptional()
  @IsString()
  VOICE_RECORDINGS_STORAGE_PATH?: string;

  @IsOptional()
  @IsString()
  VOICE_RECORDINGS_S3_BUCKET?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed:\n${errors
        .map((e) => Object.values(e.constraints ?? {}).join(', '))
        .join('\n')}`,
    );
  }

  return validated;
}

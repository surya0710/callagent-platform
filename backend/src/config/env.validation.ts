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
  VOICE_ACCENT?: string;

  @IsOptional()
  @IsString()
  AWS_REGION?: string;

  @IsOptional()
  @IsString()
  AWS_ACCESS_KEY_ID?: string;

  @IsOptional()
  @IsString()
  AWS_SECRET_ACCESS_KEY?: string;

  @IsOptional()
  @IsString()
  S3_RECORDINGS_ENABLED?: string;

  @IsOptional()
  @IsString()
  S3_RECORDINGS_BUCKET?: string;

  @IsOptional()
  @IsString()
  S3_RECORDINGS_PREFIX?: string;

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
  @IsString()
  APP_SERVER_ID?: string;

  @IsOptional()
  @IsEnum(VoiceRuntimeType)
  VOICE_RUNTIME?: VoiceRuntimeType;

  @IsOptional()
  @IsString()
  VOICE_WSS_BASE_URL?: string;

  @IsOptional()
  @IsString()
  VOICE_AUDIO_GAIN?: string;

  @IsOptional()
  @IsString()
  VOICE_AUDIO_AUTO_NORMALIZE?: string;

  @IsOptional()
  @IsString()
  VOICE_OUTBOUND_CHUNK_BYTES?: string;

  @IsOptional()
  @IsString()
  VOICE_DEBUG_SYNTHETIC_TONE?: string;

  @IsOptional()
  @IsEnum(VoiceRecordingStorageDriver)
  VOICE_RECORDINGS_STORAGE_DRIVER?: VoiceRecordingStorageDriver;

  @IsOptional()
  @IsString()
  VOICE_RECORDINGS_STORAGE_PATH?: string;

  @IsOptional()
  @IsString()
  VOICE_RECORDINGS_S3_BUCKET?: string;

  @IsOptional()
  @IsString()
  SMARTFLO_CLICK_TO_CALL_API_KEY?: string;

  @IsOptional()
  @IsUrl({ require_tld: true })
  SMARTFLO_BASE_URL?: string;

  @IsOptional()
  @IsString()
  SMARTFLO_CALLER_ID?: string;

  @IsOptional()
  @IsString()
  VOICE_REQUIRE_APP_AUTHORIZATION?: string;

  @IsOptional()
  @IsString()
  VOICE_AGENT_NAME?: string;

  @IsOptional()
  @IsString()
  VOICE_COMPANY_NAME?: string;

  @IsOptional()
  @IsString()
  VOICE_CALL_PURPOSE?: string;

  @IsOptional()
  @IsString()
  VOICE_OPENING_GREETING?: string;

  @IsOptional()
  @IsString()
  VOICE_OPENING_GREETING_AUTO_TIME?: string;

  @IsOptional()
  @IsString()
  VOICE_ASK_PERMISSION_BEFORE_PITCH?: string;

  @IsOptional()
  @IsString()
  VOICE_OPENING_IGNORE_MS?: string;

  @IsOptional()
  @IsString()
  VOICE_POST_OPENING_IGNORE_MS?: string;

  @IsOptional()
  @IsString()
  VOICE_AI_SPEAK_FIRST_ENABLED?: string;

  @IsOptional()
  @IsString()
  VOICE_AI_SPEAK_FIRST_OPENING_TIMEOUT_MS?: string;

  @IsOptional()
  @IsString()
  VOICE_AI_SPEAK_FIRST_FALLBACK_TO_WAIT_FOR_CUSTOMER?: string;

  @IsOptional()
  @IsString()
  VOICE_OPENING_SPEECH_GATE_MAX_MS?: string;

  @IsOptional()
  @IsString()
  VOICE_SPEECH_DETECTION_ENABLED?: string;

  @IsOptional()
  @IsString()
  VOICE_SPEECH_RMS_THRESHOLD?: string;

  @IsOptional()
  @IsString()
  VOICE_SPEECH_MIN_PACKETS?: string;

  @IsOptional()
  @IsString()
  VOICE_SPEECH_MIN_DURATION_MS?: string;

  @IsOptional()
  @IsString()
  VOICE_RECENT_SPEECH_MAX_AGE_MS?: string;

  @IsOptional()
  @IsString()
  VOICE_AUTO_END_CALL_ENABLED?: string;

  @IsOptional()
  @IsString()
  VOICE_AUTO_END_CALL_DELAY_MS?: string;

  @IsOptional()
  @IsString()
  VOICE_AUTO_END_CALL_MAX_WAIT_MS?: string;

  @IsOptional()
  @IsString()
  VOICE_AGENT_PLAYBOOK_ENABLED?: string;

  @IsOptional()
  @IsString()
  VOICE_AGENT_PLAYBOOK_CACHE_TTL_SECONDS?: string;

  @IsOptional()
  @IsString()
  VOICE_AGENT_PLAYBOOK_FAIL_OPEN?: string;

  @IsOptional()
  @IsString()
  VOICE_TRANSCRIPT_ENABLED?: string;

  @IsOptional()
  @IsString()
  VOICE_TRANSCRIPT_MODE?: string;

  @IsOptional()
  @IsString()
  VOICE_TRANSCRIPT_LANGUAGE_HINT?: string;

  @IsOptional()
  @IsString()
  VOICE_TRANSCRIPT_PRESERVE_HINGLISH?: string;

  @IsOptional()
  @IsString()
  VOICE_TRANSCRIPT_POSTCALL_MODEL?: string;

  @IsOptional()
  @IsString()
  VOICE_TRANSCRIPT_REALTIME_MODEL?: string;

  @IsOptional()
  @IsString()
  VOICE_TRANSCRIPT_POSTPROCESS_ENABLED?: string;

  @IsOptional()
  @IsString()
  VOICE_TRANSCRIPT_GLOSSARY?: string;

  @IsOptional()
  @IsString()
  TRAINING_TRANSCRIPTION_MODEL?: string;

  @IsOptional()
  @IsString()
  TRAINING_TRANSCRIPT_POSTPROCESS_ENABLED?: string;

  @IsOptional()
  @IsString()
  TRAINING_TRANSCRIPT_PRESERVE_HINGLISH?: string;

  @IsOptional()
  @IsString()
  TRAINING_TRANSCRIPT_GLOSSARY?: string;

  @IsOptional()
  @IsString()
  TRAINING_CALL_ANALYSIS_ENABLED?: string;

  @IsOptional()
  @IsString()
  TRAINING_CALL_ANALYSIS_MODEL?: string;

  @IsOptional()
  @IsString()
  TRAINING_CALL_ANALYSIS_BATCH_SIZE?: string;

  @IsOptional()
  @IsString()
  TRAINING_INSIGHTS_MODEL?: string;

  @IsOptional()
  @IsString()
  TRANSCRIPT_EMAIL_ENABLED?: string;

  @IsOptional()
  @IsString()
  TRANSCRIPT_EMAIL_TO?: string;

  @IsOptional()
  @IsString()
  TRANSCRIPT_EMAIL_CC?: string;

  @IsOptional()
  @IsString()
  TRANSCRIPT_EMAIL_BCC?: string;

  @IsOptional()
  @IsString()
  TRANSCRIPT_EMAIL_FROM?: string;

  @IsOptional()
  @IsString()
  TRANSCRIPT_EMAIL_SUBJECT_PREFIX?: string;

  @IsOptional()
  @IsString()
  TRANSCRIPT_EMAIL_INCLUDE_SUMMARY?: string;

  @IsOptional()
  @IsString()
  TRANSCRIPT_EMAIL_INCLUDE_RECORDING_LINK?: string;

  @IsOptional()
  @IsString()
  TRANSCRIPT_EMAIL_INCLUDE_DASHBOARD_LINK?: string;

  @IsOptional()
  @IsString()
  TRANSCRIPT_EMAIL_SEND_FOR_AUTHORIZED_ONLY?: string;

  @IsOptional()
  @IsString()
  TRANSCRIPT_EMAIL_ATTACH_TXT?: string;

  @IsOptional()
  @IsString()
  FRONTEND_APP_URL?: string;

  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @IsString()
  SMTP_PORT?: string;

  @IsOptional()
  @IsString()
  SMTP_SECURE?: string;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASS?: string;

  @IsOptional()
  @IsString()
  SMTP_FROM?: string;
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

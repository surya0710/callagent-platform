import { Logger } from '@nestjs/common';

const THROTTLE_MS = 1000;
const lastLogAtByKey = new Map<string, number>();

export function isVoiceDebugAudioEnabled(): boolean {
  return process.env.VOICE_DEBUG_AUDIO?.trim().toLowerCase() === 'true';
}

export function voiceDebugLog(
  logger: Logger,
  streamSid: string,
  stage: string,
  fields: Record<string, string | number | boolean | undefined | null>,
  options?: { bypassThrottle?: boolean },
): void {
  if (!isVoiceDebugAudioEnabled()) {
    return;
  }

  const key = `${streamSid}:${stage}`;
  const now = Date.now();
  const last = lastLogAtByKey.get(key) ?? 0;
  if (!options?.bypassThrottle && now - last < THROTTLE_MS) {
    return;
  }
  lastLogAtByKey.set(key, now);

  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => `${name}=${value}`)
    .join(' ');

  logger.log(`[voice-debug] streamSid=${streamSid} stage=${stage}${parts ? ` ${parts}` : ''}`);
}

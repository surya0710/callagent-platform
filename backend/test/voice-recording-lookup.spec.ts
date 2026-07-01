import { VoiceRecordingService } from '../src/modules/voice/audio/voice-recording.service';

describe('VoiceRecordingService.resolveRecordingLookup', () => {
  function createService(options?: {
    session?: {
      recordingS3Url?: string | null;
      callId?: string;
    };
    callRecordingS3Url?: string | null;
    s3Enabled?: boolean;
  }) {
    const voiceSessionService = {
      resolveByStreamSid: jest.fn().mockResolvedValue(options?.session),
    };
    const s3RecordingStorageService = {
      normalizeS3Key: (value?: string | null) => {
        const trimmed = value?.trim();
        return trimmed ? trimmed : null;
      },
      isEnabled: () => options?.s3Enabled ?? true,
      objectExists: jest.fn().mockResolvedValue(true),
    };
    const prisma = {
      call: {
        findUnique: jest.fn().mockResolvedValue(
          options?.callRecordingS3Url
            ? { recordingS3Url: options.callRecordingS3Url }
            : null,
        ),
      },
    };

    const service = new VoiceRecordingService(
      voiceSessionService as never,
      s3RecordingStorageService as never,
      prisma as never,
    );

    return { service, voiceSessionService, prisma };
  }

  it('prefers in-memory recording metadata for the streamSid', async () => {
    const { service } = createService();
    jest
      .spyOn(service, 'getRecordingS3Key')
      .mockReturnValue('recordings/2026-06-30/MZ123.wav');

    await expect(service.resolveRecordingLookup('MZ123')).resolves.toEqual({
      streamSid: 'MZ123',
      recordingExists: true,
      recordingStorage: 'memory',
      s3Key: 'recordings/2026-06-30/MZ123.wav',
      downloadUrlAvailable: true,
    });
  });

  it('uses session recordingS3Url when memory metadata is missing', async () => {
    const { service, prisma } = createService({
      session: {
        recordingS3Url: 'recordings/2026-06-30/smartflo_abc.wav',
        telephonyProvider: 'smartflo',
      } as never,
    });

    const lookup = await service.resolveRecordingLookup('smartflo_abc', {
      sessionRecordingS3Url: 'recordings/2026-06-30/smartflo_abc.wav',
    });

    expect(lookup).toMatchObject({
      streamSid: 'smartflo_abc',
      recordingExists: true,
      recordingStorage: 'session',
      s3Key: 'recordings/2026-06-30/smartflo_abc.wav',
    });
    expect(prisma.call.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to call recordingS3Url for older sessions', async () => {
    const { service } = createService({
      session: { callId: 'call-1' },
      callRecordingS3Url: 'recordings/2026-06-30/exotel_CA-9.wav',
    });

    const lookup = await service.resolveRecordingLookup('exotel_CA-9', {
      callId: 'call-1',
      callRecordingS3Url: 'recordings/2026-06-30/exotel_CA-9.wav',
    });

    expect(lookup).toMatchObject({
      streamSid: 'exotel_CA-9',
      recordingExists: true,
      recordingStorage: 'call',
      s3Key: 'recordings/2026-06-30/exotel_CA-9.wav',
    });
  });

  it('returns none when no recording metadata exists', async () => {
    const { service } = createService();

    await expect(service.resolveRecordingLookup('missing-stream')).resolves.toEqual({
      streamSid: 'missing-stream',
      recordingExists: false,
      recordingStorage: 'none',
      s3Key: null,
      downloadUrlAvailable: false,
    });
  });
});

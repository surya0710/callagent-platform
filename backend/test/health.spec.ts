import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { HealthController } from '../src/modules/health/health.controller';
import { HealthService } from '../src/modules/health/health.service';
import { PrismaService } from '../src/database/prisma.service';

describe('Health endpoint', () => {
  let controller: HealthController;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn().mockResolvedValue([1]),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'NODE_ENV') return 'test';
              if (key === 'REDIS_HOST') return '127.0.0.1';
              if (key === 'REDIS_PORT') return 6379;
              return undefined;
            },
            getOrThrow: (key: string) => {
              if (key === 'REDIS_HOST') return '127.0.0.1';
              if (key === 'REDIS_PORT') return 6379;
              throw new Error(`Missing config: ${key}`);
            },
          },
        },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('GET /health returns ok payload', () => {
    const result = controller.getHealth();

    expect(result).toMatchObject({
      status: 'ok',
      service: 'ai-voice-platform-api',
      environment: 'test',
    });
    expect(result.timestamp).toBeDefined();
  });
});

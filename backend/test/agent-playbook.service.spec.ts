import { ConfigService } from '@nestjs/config';
import { AgentPlaybookService } from '../src/modules/training/agent-playbook.service';

describe('AgentPlaybookService', () => {
  const createService = (env: Record<string, string | undefined> = {}) => {
    const prisma = {
      agentPlaybook: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      $transaction: jest.fn().mockResolvedValue(undefined),
    };
    const configService = {
      get: (key: string) => env[key],
    } as ConfigService;

    return {
      service: new AgentPlaybookService(prisma as never, configService),
      prisma,
    };
  };

  it('archives previous active playbook when activating one approved playbook', async () => {
    const { service, prisma } = createService();
    const approved = {
      id: 'playbook_new',
      status: 'approved',
      version: 2,
      approvedBy: 'user_1',
      approvedAt: new Date('2026-06-17T10:00:00.000Z'),
    };

    prisma.agentPlaybook.findUnique
      .mockResolvedValueOnce(approved)
      .mockResolvedValueOnce({ ...approved, status: 'active' });
    prisma.agentPlaybook.update.mockResolvedValue({ ...approved, status: 'active' });

    const result = await service.activatePlaybook('playbook_new', 'user_1');

    expect(result.status).toBe('active');
    expect(prisma.agentPlaybook.updateMany).toHaveBeenCalledWith({
      where: { status: 'active', id: { not: 'playbook_new' } },
      data: { status: 'archived' },
    });
    expect(prisma.agentPlaybook.update).toHaveBeenCalledWith({
      where: { id: 'playbook_new' },
      data: expect.objectContaining({ status: 'active' }),
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('loads active playbook for runtime and caches it', async () => {
    const { service, prisma } = createService({
      VOICE_AGENT_PLAYBOOK_ENABLED: 'true',
      VOICE_AGENT_PLAYBOOK_CACHE_TTL_SECONDS: '60',
    });
    const active = {
      id: 'playbook_active',
      title: 'Active Playbook',
      version: 1,
      playbookText: 'Playbook text',
      agentInstructions: 'Agent instructions',
      commonObjectionsJson: null,
      objectionResponsesJson: null,
      winningPhrasesJson: null,
      badPhrasesJson: null,
      qualificationSignalsJson: null,
      followUpRulesJson: null,
      safetyRulesJson: null,
    };
    prisma.agentPlaybook.findFirst.mockResolvedValue(active);

    await expect(service.getActivePlaybookForRuntime()).resolves.toEqual(active);
    await expect(service.getActivePlaybookForRuntime()).resolves.toEqual(active);
    expect(prisma.agentPlaybook.findFirst).toHaveBeenCalledTimes(1);
  });

  it('returns null when no active playbook exists', async () => {
    const { service, prisma } = createService({
      VOICE_AGENT_PLAYBOOK_ENABLED: 'true',
    });
    prisma.agentPlaybook.findFirst.mockResolvedValue(null);

    await expect(service.getActivePlaybookForRuntime()).resolves.toBeNull();
  });

  it('skips runtime lookup when playbook injection is disabled', async () => {
    const { service, prisma } = createService({
      VOICE_AGENT_PLAYBOOK_ENABLED: 'false',
    });

    await expect(service.getActivePlaybookForRuntime()).resolves.toBeNull();
    expect(prisma.agentPlaybook.findFirst).not.toHaveBeenCalled();
  });
});

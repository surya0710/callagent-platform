import { RuntimeAgentPlaybook } from '../src/modules/training/agent-playbook.service';
import {
  buildOpeningSessionInstructions,
  mergeOpeningContext,
} from '../src/modules/voice/voice-opening.util';
import {
  buildVoiceRuntimeInstructions,
  VOICE_AGENT_PLAYBOOK_SAFETY_BLOCK,
} from '../src/modules/voice/voice-runtime-instructions.util';

describe('voice-runtime-instructions.util', () => {
  const playbook: RuntimeAgentPlaybook = {
    id: 'playbook_1',
    title: 'Approved Training Playbook',
    version: 3,
    playbookText: 'Ask discovery question: What challenge are you solving?',
    agentInstructions: 'Use the approved greeting and handle price objections calmly.',
    commonObjectionsJson: null,
    objectionResponsesJson: null,
    winningPhrasesJson: null,
    badPhrasesJson: null,
    qualificationSignalsJson: null,
    followUpRulesJson: null,
    safetyRulesJson: null,
  };

  it('injects playbook without removing opening instructions', () => {
    const baseInstructions = buildOpeningSessionInstructions(
      mergeOpeningContext({
        agentName: 'Aisha',
        companyName: 'TATD',
        callPurpose: 'to discuss your recent enquiry',
        openingGreeting: 'Namaste',
      }),
    );

    const instructions = buildVoiceRuntimeInstructions({
      baseInstructions,
      activePlaybook: playbook,
    });

    expect(instructions).toContain('Speak first when the call begins');
    expect(instructions).toContain('Namaste');
    expect(instructions).toContain('Approved Training Playbook v3');
    expect(instructions).toContain('What challenge are you solving?');
  });

  it('keeps the fixed safety block after playbook guidance', () => {
    const instructions = buildVoiceRuntimeInstructions({
      baseInstructions: 'Base voice behavior.',
      activePlaybook: playbook,
    });

    expect(instructions.indexOf(playbook.playbookText)).toBeGreaterThan(-1);
    expect(instructions.indexOf(VOICE_AGENT_PLAYBOOK_SAFETY_BLOCK)).toBeGreaterThan(
      instructions.indexOf(playbook.playbookText),
    );
    expect(instructions.trim().endsWith(VOICE_AGENT_PLAYBOOK_SAFETY_BLOCK)).toBe(true);
  });

  it('falls back to base instructions when no active playbook exists', () => {
    const instructions = buildVoiceRuntimeInstructions({
      baseInstructions: 'Existing runtime behavior.',
      activePlaybook: null,
    });

    expect(instructions).toBe('Existing runtime behavior.');
    expect(instructions).not.toContain('Active approved AI playbook guidance');
    expect(instructions).not.toContain('Hard rules:');
  });
});

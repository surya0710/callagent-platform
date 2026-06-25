import { buildCallContextInstructions } from '../src/modules/voice/voice-call-context.util';
import {
  buildConversationTurnGuidance,
  findForbiddenDomainTerms,
  validateVoiceRuntimeInstructions,
  VOICE_DOMAIN_LOCK_BLOCK,
  VOICE_DOMAIN_REQUIRED_PHRASE,
} from '../src/modules/voice/voice-domain.util';
import {
  buildPostOpeningSessionInstructions,
  mergeOpeningContext,
} from '../src/modules/voice/voice-opening.util';
import { buildVoiceRuntimeInstructions } from '../src/modules/voice/voice-runtime-instructions.util';

describe('voice-domain.util', () => {
  const tatdCallContext = {
    bookingNumber: 'OD123456',
    customerName: 'Rahul Sharma',
    driverName: 'Rajesh Kumar',
  };

  function buildFullRuntimeInstructions(callContext = tatdCallContext): string {
    const baseInstructions = buildPostOpeningSessionInstructions(
      mergeOpeningContext({
        agentName: 'Aisha',
        companyName: 'TATD',
      }),
    );
    const callContextInstructions = buildCallContextInstructions(callContext);

    return buildVoiceRuntimeInstructions({
      baseInstructions,
      callContextInstructions,
      activePlaybook: {
        id: 'p1',
        title: 'Driver Service Feedback Playbook',
        version: 1,
        agentInstructions:
          'Collect feedback on driver service quality, punctuality, and ride experience.',
        playbookText:
          'Ask about the driver service booking. If the customer mentions the driver, explore ride quality and driver behavior.',
        commonObjectionsJson: null,
        objectionResponsesJson: null,
        winningPhrasesJson: null,
        badPhrasesJson: null,
        qualificationSignalsJson: null,
        followUpRulesJson: null,
        safetyRulesJson: null,
      },
    });
  }

  describe('validateVoiceRuntimeInstructions', () => {
    it('passes generated runtime instructions', () => {
      const result = validateVoiceRuntimeInstructions(buildFullRuntimeInstructions());

      expect(result.valid).toBe(true);
      expect(result.missingRequired).toEqual([]);
      expect(result.forbiddenFound).toEqual([]);
    });

    it('requires on-demand driver service phrase', () => {
      const result = validateVoiceRuntimeInstructions('Generic assistant instructions.');

      expect(result.valid).toBe(false);
      expect(result.missingRequired).toContain(VOICE_DOMAIN_REQUIRED_PHRASE);
    });

    it('flags forbidden delivery and order wording', () => {
      const result = validateVoiceRuntimeInstructions(
        'This is an on-demand driver service call. How was your delivery experience?',
      );

      expect(result.valid).toBe(false);
      expect(result.forbiddenFound).toContain('delivery');
    });

    it('detects forbidden terms with word boundaries', () => {
      expect(findForbiddenDomainTerms('How was your order delivered?')).toEqual([
        'order',
      ]);
      expect(findForbiddenDomainTerms('on-demand driver service booking')).toEqual([]);
    });
  });

  describe('conversation behavior guidance', () => {
    it('guides driver service feedback when booking context is present', () => {
      const instructions = buildFullRuntimeInstructions();

      expect(instructions).toContain(VOICE_DOMAIN_LOCK_BLOCK);
      expect(instructions).toContain('Booking Number: OD123456');
      expect(instructions).toContain('Driver Name: Rajesh Kumar');
      expect(instructions).toContain('How was your experience with the driver service?');
      expect(instructions).not.toMatch(/how was your delivery/i);
      expect(instructions).not.toMatch(/how was your order/i);
    });

    it('guides feedback question after customer says yes', () => {
      const guidance = buildConversationTurnGuidance(
        'after_availability_confirmed',
        tatdCallContext,
      );

      expect(guidance).toContain('customer agreed to speak');
      expect(guidance).toContain('How was your experience with the driver service?');
      expect(guidance).toContain('Do not ask about retail logistics');
    });

    it('follows driver issue path when customer mentions driver', () => {
      const guidance = buildConversationTurnGuidance(
        'customer_mentioned_driver',
        tatdCallContext,
      );

      expect(guidance).toContain('customer mentioned the driver');
      expect(guidance).toContain('Rajesh Kumar');
      expect(guidance).toContain('driver service experience');
      expect(guidance).toContain('Do not switch to retail logistics');
      expect(guidance).not.toMatch(/how was your delivery/i);
    });

    it('includes post-opening yes-handling in session instructions', () => {
      const instructions = buildPostOpeningSessionInstructions(
        mergeOpeningContext({
          agentName: 'Aisha',
          companyName: 'TATD',
        }),
      );

      expect(instructions).toContain('on-demand driver service');
      expect(instructions).toContain(
        'If the customer says yes or agrees to speak, ask about driver service or ride experience',
      );
      expect(instructions).not.toMatch(/how was your delivery/i);
    });
  });
});

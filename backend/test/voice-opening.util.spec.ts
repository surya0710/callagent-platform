import {
  buildExampleOpeningMessage,
  buildOpeningSessionInstructions,
  mergeOpeningContext,
  parseAskPermissionBeforePitch,
  VOICE_OPENING_DEFAULTS,
} from '../src/modules/voice/voice-opening.util';

describe('voice-opening.util', () => {
  describe('mergeOpeningContext', () => {
    it('applies defaults for missing fields', () => {
      expect(mergeOpeningContext({})).toEqual(VOICE_OPENING_DEFAULTS);
    });

    it('merges partial overrides', () => {
      expect(
        mergeOpeningContext({
          agentName: 'Aisha',
          companyName: 'TATD',
          callPurpose: 'to discuss your interest in our services',
          openingGreeting: 'Hi, good morning',
        }),
      ).toEqual({
        agentName: 'Aisha',
        companyName: 'TATD',
        callPurpose: 'to discuss your interest in our services',
        openingGreeting: 'Hi, good morning',
        askPermissionBeforePitch: true,
      });
    });
  });

  describe('buildExampleOpeningMessage', () => {
    it('includes permission question by default', () => {
      const message = buildExampleOpeningMessage({
        agentName: 'Aisha',
        companyName: 'TATD',
        callPurpose: 'to discuss your interest in our services',
        openingGreeting: 'Hi, good morning',
      });

      expect(message).toContain('Aisha');
      expect(message).toContain('TATD');
      expect(message).toContain('discuss your interest in our services');
      expect(message).toContain('good time');
    });

    it('omits permission when disabled', () => {
      const message = buildExampleOpeningMessage({
        agentName: 'Aisha',
        companyName: 'TATD',
        callPurpose: 'to discuss your interest in our services',
        askPermissionBeforePitch: false,
      });

      expect(message).not.toContain('good time');
    });
  });

  describe('buildOpeningSessionInstructions', () => {
    it('instructs the agent to speak first', () => {
      const instructions = buildOpeningSessionInstructions({
        agentName: 'Aisha',
        companyName: 'TATD',
        callPurpose: 'to discuss your interest in our services',
        openingGreeting: 'Hi',
      });

      expect(instructions).toContain('Speak first when the call begins');
      expect(instructions).toContain('Aisha');
      expect(instructions).toContain('TATD');
      expect(instructions).not.toContain('Do not greet or speak first');
    });
  });

  describe('parseAskPermissionBeforePitch', () => {
    it('parses boolean strings', () => {
      expect(parseAskPermissionBeforePitch('true')).toBe(true);
      expect(parseAskPermissionBeforePitch('false')).toBe(false);
      expect(parseAskPermissionBeforePitch(undefined)).toBeUndefined();
    });
  });
});

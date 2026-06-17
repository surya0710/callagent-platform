import {
  buildExampleOpeningMessage,
  buildOpeningResponseInstructions,
  buildOpeningSessionInstructions,
  buildPostOpeningSessionInstructions,
  formatCallPurposeLine,
  mergeOpeningContext,
  parseAskPermissionBeforePitch,
  sanitizeBaseInstructionsForOpening,
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

    it('formats free-text call purpose naturally', () => {
      const message = buildExampleOpeningMessage({
        agentName: 'Suryakant',
        companyName: 'tatd',
        callPurpose:
          'Recently you had a booking with us, how was your experience',
        openingGreeting: 'Hi, good morning',
      });

      expect(message).toContain('calling about Recently you had a booking');
      expect(message).not.toContain("I'm reaching out Recently");
    });
  });

  describe('formatCallPurposeLine', () => {
    it('prefixes purpose with about when needed', () => {
      expect(formatCallPurposeLine('your recent booking')).toBe(
        "I'm calling about your recent booking",
      );
      expect(formatCallPurposeLine('to follow up on your booking')).toBe(
        "I'm calling to follow up on your booking",
      );
    });
  });

  describe('buildExampleOpeningMessage permission', () => {
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
      expect(instructions).toContain('Do not ask discovery questions');
      expect(instructions).toContain('remain silent');
      expect(instructions).not.toContain('Do not greet or speak first');
    });

    it('strips conflicting caller-first env instructions', () => {
      const instructions = buildOpeningSessionInstructions(
        {
          agentName: 'Aisha',
          companyName: 'TATD',
          callPurpose: 'to discuss your interest in our services',
        },
        'Custom rule. Do not greet or speak first. Wait until the caller has finished speaking before responding.',
      );

      expect(instructions).not.toContain('Do not greet or speak first');
      expect(instructions).toContain('Custom rule');
    });
  });

  describe('buildOpeningResponseInstructions', () => {
    it('requires a single scripted opening line and stop', () => {
      const instructions = buildOpeningResponseInstructions({
        agentName: 'Aisha',
        companyName: 'TATD',
        callPurpose: 'to discuss your interest in our services',
        openingGreeting: 'Hi, good morning',
      });

      expect(instructions).toContain('Aisha');
      expect(instructions).toContain('Then STOP immediately');
      expect(instructions).toContain('good morning');
      expect(instructions).toContain('Do not ask discovery questions');
      expect(instructions).toContain('stay silent until the customer responds');
    });
  });

  describe('buildPostOpeningSessionInstructions', () => {
    it('waits for caller after opening', () => {
      const instructions = buildPostOpeningSessionInstructions({
        agentName: 'Aisha',
        companyName: 'TATD',
        callPurpose: 'to discuss your interest in our services',
      });

      expect(instructions).toContain('opening greeting is already done');
      expect(instructions).toContain('Maximum 20 words');
      expect(instructions).toContain('do not repeat unless asked');
    });
  });

  describe('sanitizeBaseInstructionsForOpening', () => {
    it('removes caller-first conflicts', () => {
      const sanitized = sanitizeBaseInstructionsForOpening(
        'Be helpful. Do not greet or speak first.',
      );
      expect(sanitized).not.toContain('Do not greet or speak first');
      expect(sanitized).toContain('Be helpful');
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

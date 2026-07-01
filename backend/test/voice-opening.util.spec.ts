import {
  buildExampleOpeningMessage,
  buildOpeningResponseInstructions,
  buildOpeningSessionInstructions,
  buildPostOpeningSessionInstructions,
  formatCallPurposeLine,
  getTimeAwareGreeting,
  mergeOpeningContext,
  parseAskPermissionBeforePitch,
  resolveTimeAwareOpeningGreeting,
  sanitizeBaseInstructionsForOpening,
  canTriggerOpening,
  getOpeningSkipReason,
  hasOpeningPreTimerCustomerSpeech,
  buildGreetingDiagnosticLog,
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

    it('uses customer name and booking number without repeating call purpose', () => {
      const message = buildExampleOpeningMessage(
        {
          agentName: 'Aisha',
          companyName: 'TATD',
          callPurpose: 'for a quick follow-up',
          openingGreeting: 'Namaste',
        },
        {
          customerName: 'Rahul Sharma',
          bookingNumber: 'OD482917',
        },
      );

      expect(message).toBe(
        'Namaste Rahul ji, this is Aisha calling from TATD regarding your booking OD482917. Is this a good time to speak?',
      );
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

  describe('time-aware greeting', () => {
    it('uses evening greeting for India evening time', () => {
      const indiaEvening = new Date('2026-06-17T12:20:00.000Z');

      expect(getTimeAwareGreeting(indiaEvening)).toBe('Good evening');
      expect(
        resolveTimeAwareOpeningGreeting('Hi, good morning', indiaEvening),
      ).toBe('Hi, Good evening');
    });

    it('preserves non-time-based greeting', () => {
      const indiaEvening = new Date('2026-06-17T12:20:00.000Z');

      expect(resolveTimeAwareOpeningGreeting('Namaste', indiaEvening)).toBe(
        'Namaste',
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
      expect(instructions).toContain('TATD');
      expect(instructions).toContain('good morning');
      expect(instructions).toContain('Do not continue with discovery questions');
      expect(instructions).toContain('stop and wait for the customer');
      expect(instructions).toContain('Then STOP immediately');
    });

    it('frames opening as driver service feedback when callContext is provided', () => {
      const instructions = buildOpeningResponseInstructions(
        {
          agentName: 'Aisha',
          companyName: 'TATD',
          callPurpose: 'for a quick follow-up',
          openingGreeting: 'Good morning',
        },
        {
          bookingNumber: 'OD482917',
          customerName: 'Rahul Sharma',
        },
      );

      expect(instructions).toContain('on-demand driver service booking feedback call');
      expect(instructions).toContain('booking OD482917');
      expect(instructions).toContain('Is this a good time to speak?');
      expect(instructions).toContain('do not repeat the call purpose in the opening');
      expect(instructions).toContain(
        'Good morning Rahul ji, this is Aisha calling from TATD regarding your booking OD482917. Is this a good time to speak?',
      );
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

  describe('canTriggerOpening', () => {
    const baseReady = {
      aiSpeakFirstEnabled: true,
      openingState: 'ready_to_speak' as const,
      authorized: true,
      smartfloStartReceived: true,
      streamSidKnown: true,
      smartfloWebSocketOpen: true,
      openAiWebSocketOpen: true,
      openAiSessionCreated: true,
      openAiSessionUpdated: true,
      responsePending: false,
      openingAlreadyRequested: false,
    };

    it('returns true when all readiness conditions are met', () => {
      expect(canTriggerOpening(baseReady)).toBe(true);
    });

    it('returns false when speak-first is disabled', () => {
      expect(
        canTriggerOpening({ ...baseReady, aiSpeakFirstEnabled: false }),
      ).toBe(false);
    });

    it('returns false when opening was already requested', () => {
      expect(
        canTriggerOpening({ ...baseReady, openingAlreadyRequested: true }),
      ).toBe(false);
      expect(getOpeningSkipReason({ ...baseReady, openingAlreadyRequested: true })).toBe(
        'opening_already_requested',
      );
    });

    it('returns false before OpenAI session.updated', () => {
      expect(
        canTriggerOpening({
          ...baseReady,
          openAiSessionUpdated: false,
          openingState: 'ready_to_speak',
        }),
      ).toBe(false);
      expect(
        getOpeningSkipReason({
          ...baseReady,
          openAiSessionUpdated: false,
          openingState: 'ready_to_speak',
        }),
      ).toBe('openai_session_not_updated');
    });

    it('returns false before OpenAI session.created', () => {
      expect(
        canTriggerOpening({
          ...baseReady,
          openAiSessionCreated: false,
          openingState: 'waiting_for_openai_ready',
        }),
      ).toBe(false);
      expect(
        getOpeningSkipReason({
          ...baseReady,
          openAiSessionCreated: false,
          openingState: 'waiting_for_openai_ready',
        }),
      ).toBe('openai_session_not_created');
    });
  });

  describe('hasOpeningPreTimerCustomerSpeech', () => {
    it('requires sustained speech before the opening timer fires', () => {
      expect(hasOpeningPreTimerCustomerSpeech(5, 500)).toBe(false);
      expect(hasOpeningPreTimerCustomerSpeech(6, 399)).toBe(false);
      expect(hasOpeningPreTimerCustomerSpeech(6, 400)).toBe(true);
    });
  });

  describe('buildGreetingDiagnosticLog', () => {
    it('includes greeting stage diagnostic fields', () => {
      expect(
        buildGreetingDiagnosticLog({
          provider: 'exotel',
          sessionId: 'exotel_123',
          stage: 'GREETING',
          openAiReady: true,
          greetingScheduled: true,
          delayMs: 2500,
        }),
      ).toEqual({
        provider: 'exotel',
        sessionId: 'exotel_123',
        stage: 'GREETING',
        openAiReady: true,
        greetingScheduled: true,
        greetingSent: undefined,
        firstAudioDelta: undefined,
        firstOutboundMedia: undefined,
        skipReason: null,
        delayMs: 2500,
        message: 'voice_greeting_diag',
      });
    });
  });
});

import {
  isLikelyAssistantEcho,
  isValidCustomerTranscript,
  shouldAllowResponseCreate,
  shouldForwardInboundWhileAwaiting,
} from '../src/modules/voice/runtime/voice-turn-taking.util';

describe('voice-turn-taking.util', () => {
  describe('isValidCustomerTranscript', () => {
    it('rejects empty and whitespace-only transcripts', () => {
      expect(isValidCustomerTranscript(undefined)).toBe(false);
      expect(isValidCustomerTranscript('')).toBe(false);
      expect(isValidCustomerTranscript('   ')).toBe(false);
    });

    it('accepts non-empty customer transcripts', () => {
      expect(isValidCustomerTranscript('Yes')).toBe(true);
      expect(isValidCustomerTranscript('Hello, are you there?')).toBe(true);
    });
  });

  describe('isLikelyAssistantEcho', () => {
    it('detects exact and partial assistant echo', () => {
      const assistant =
        'Namaste. This is Priya from Acme regarding your booking. Is this a good time to speak?';
      expect(
        isLikelyAssistantEcho(
          'Is this a good time to speak?',
          assistant,
        ),
      ).toBe(true);
      expect(isLikelyAssistantEcho('Yes', assistant)).toBe(false);
    });
  });

  describe('shouldAllowResponseCreate', () => {
    it('allows opening even while awaiting customer input', () => {
      expect(
        shouldAllowResponseCreate({
          awaitingCustomerInput: true,
          customerTurnConfirmed: false,
          responseRequested: false,
          responseInProgress: false,
          source: 'opening',
        }).allowed,
      ).toBe(true);
    });

    it('blocks customer speech while awaiting customer input', () => {
      const result = shouldAllowResponseCreate({
        awaitingCustomerInput: true,
        customerTurnConfirmed: false,
        responseRequested: false,
        responseInProgress: false,
        source: 'customer_speech',
      });
      expect(result.allowed).toBe(false);
      expect(result.skipReason).toBe('awaiting_customer_input');
    });

    it('allows customer speech after turn confirmation', () => {
      expect(
        shouldAllowResponseCreate({
          awaitingCustomerInput: false,
          customerTurnConfirmed: true,
          responseRequested: false,
          responseInProgress: false,
          source: 'customer_speech',
        }).allowed,
      ).toBe(true);
    });

    it('allows only one manual fallback per assistant turn', () => {
      expect(
        shouldAllowResponseCreate({
          awaitingCustomerInput: false,
          customerTurnConfirmed: true,
          responseRequested: false,
          responseInProgress: false,
          source: 'manual_fallback',
          manualFallback: true,
          manualFallbackUsedSinceLastResponse: true,
        }).skipReason,
      ).toBe('manual_fallback_already_used');
    });
  });

  describe('shouldForwardInboundWhileAwaiting', () => {
    it('blocks inbound while awaiting customer input', () => {
      expect(
        shouldForwardInboundWhileAwaiting({
          awaitingCustomerInput: true,
          customerTurnConfirmed: false,
          aiTurnActive: false,
          bargeInConfirmed: false,
        }),
      ).toEqual({ forward: false, reason: 'awaiting_customer_input' });
    });

    it('blocks inbound during ai turn unless barge-in confirmed', () => {
      expect(
        shouldForwardInboundWhileAwaiting({
          awaitingCustomerInput: false,
          customerTurnConfirmed: false,
          aiTurnActive: true,
          bargeInConfirmed: false,
        }),
      ).toEqual({ forward: false, reason: 'ai_turn_active' });
    });

    it('allows inbound after customer turn confirmation', () => {
      expect(
        shouldForwardInboundWhileAwaiting({
          awaitingCustomerInput: false,
          customerTurnConfirmed: true,
          aiTurnActive: false,
          bargeInConfirmed: false,
        }),
      ).toEqual({ forward: true, reason: 'allowed' });
    });
  });
});

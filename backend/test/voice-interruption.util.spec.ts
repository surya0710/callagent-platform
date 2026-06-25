import {
  buildTurnResponseInstructions,
  shouldCancelResponseOnInterrupt,
  shouldIgnoreCustomerInterrupt,
} from '../src/modules/voice/voice-interruption.util';

describe('voice-interruption.util', () => {
  describe('shouldIgnoreCustomerInterrupt', () => {
    const baseInput = {
      aiSpeaking: true,
      speechDurationMs: 120,
      speechMinDurationMs: 80,
      rms: 0.05,
      rmsThreshold: 0.01,
      aiSpeakingStartedAt: new Date(Date.now() - 500),
    };

    it('ignores interrupt when AI is not speaking', () => {
      expect(
        shouldIgnoreCustomerInterrupt({ ...baseInput, aiSpeaking: false }),
      ).toEqual({ ignore: true, reason: 'ai_not_speaking' });
    });

    it('ignores very short speech during AI turn', () => {
      expect(
        shouldIgnoreCustomerInterrupt({ ...baseInput, speechDurationMs: 20 }),
      ).toEqual({ ignore: true, reason: 'speech_too_short' });
    });

    it('ignores low-energy packets', () => {
      expect(
        shouldIgnoreCustomerInterrupt({ ...baseInput, rms: 0.005 }),
      ).toEqual({ ignore: true, reason: 'low_energy' });
    });

    it('ignores speech within echo-tail window after AI starts', () => {
      expect(
        shouldIgnoreCustomerInterrupt({
          ...baseInput,
          aiSpeakingStartedAt: new Date(Date.now() - 100),
        }),
      ).toEqual({ ignore: true, reason: 'echo_tail_window' });
    });

    it('accepts valid customer interrupt after echo tail', () => {
      expect(shouldIgnoreCustomerInterrupt(baseInput)).toEqual({ ignore: false });
    });
  });

  describe('shouldCancelResponseOnInterrupt', () => {
    it('cancels once per response id', () => {
      expect(
        shouldCancelResponseOnInterrupt({
          currentResponseId: 'resp_1',
          cancelSentForResponseId: undefined,
          responseInProgress: true,
        }),
      ).toEqual({ shouldCancel: true });

      expect(
        shouldCancelResponseOnInterrupt({
          currentResponseId: 'resp_1',
          cancelSentForResponseId: 'resp_1',
          responseInProgress: true,
        }),
      ).toEqual({ shouldCancel: false, skipReason: 'cancel_already_sent' });
    });

    it('skips cancel when response is not in progress', () => {
      expect(
        shouldCancelResponseOnInterrupt({
          currentResponseId: 'resp_1',
          responseInProgress: false,
        }),
      ).toEqual({ shouldCancel: false, skipReason: 'response_not_in_progress' });
    });
  });

  describe('buildTurnResponseInstructions', () => {
    it('includes language and interruption guidance after barge-in', () => {
      const instructions = buildTurnResponseInstructions({
        preferredLanguage: 'english',
        wasInterrupted: true,
        lastAssistantText: 'Is this a good time to speak about your booking?',
      });

      expect(instructions).toContain('Reply in english');
      expect(instructions).toContain('If interrupted, do not repeat yourself');
      expect(instructions).toContain('Do not repeat your previous response');
    });
  });
});

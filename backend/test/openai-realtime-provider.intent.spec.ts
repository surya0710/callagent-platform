import { detectCustomerCallEndIntent } from '../src/modules/voice/runtime/openai-realtime.provider';

describe('detectCustomerCallEndIntent', () => {
  it('does not end the call for affirmative availability responses', () => {
    expect(
      detectCustomerCallEndIntent('Yes, this is a good time to speak', {
        awaitingOpeningAvailabilityResponse: true,
      }),
    ).toBeNull();
    expect(
      detectCustomerCallEndIntent('Sure, go ahead. I am not busy.', {
        awaitingOpeningAvailabilityResponse: true,
      }),
    ).toBeNull();
  });

    it('detects negative opening availability responses', () => {
      expect(
        detectCustomerCallEndIntent('No', {
          awaitingOpeningAvailabilityResponse: true,
        }),
      ).toBe('negative_availability');
      expect(detectCustomerCallEndIntent('I am busy, call me later')).toBe(
        'negative_availability',
      );
      expect(detectCustomerCallEndIntent('Abhi nahi, baad mein call karna')).toBe(
        'negative_availability',
      );
    });

    it('does not treat the word later alone as negative availability', () => {
      expect(detectCustomerCallEndIntent('See you later maybe')).toBeNull();
    });

  it('does not treat a bare no as hangup outside the opening permission response', () => {
    expect(detectCustomerCallEndIntent('No')).toBeNull();
  });

  it('detects explicit customer hangup requests', () => {
    expect(detectCustomerCallEndIntent('Please cut the call')).toBe(
      'explicit_hangup',
    );
    expect(detectCustomerCallEndIntent('Hang up now')).toBe('explicit_hangup');
    expect(detectCustomerCallEndIntent('Call काट दो')).toBe('explicit_hangup');
  });
});

import {
  detectCustomerLanguage,
  evaluatePreferredLanguageUpdate,
  isAmbiguousShortUtterance,
  resolveResponseLanguage,
} from '../src/modules/voice/voice-language.util';

describe('voice-language.util', () => {
  describe('isAmbiguousShortUtterance', () => {
    it('treats short acknowledgements as ambiguous', () => {
      expect(isAmbiguousShortUtterance('yes')).toBe(true);
      expect(isAmbiguousShortUtterance('haan')).toBe(true);
      expect(isAmbiguousShortUtterance('ji')).toBe(true);
      expect(isAmbiguousShortUtterance('okay')).toBe(true);
      expect(isAmbiguousShortUtterance('hello')).toBe(true);
    });

    it('does not treat complete sentences as ambiguous', () => {
      expect(
        isAmbiguousShortUtterance(
          'The driver was late and I want a refund please',
        ),
      ).toBe(false);
    });
  });

  describe('detectCustomerLanguage', () => {
    it('keeps English for Indian names in an English sentence', () => {
      const result = detectCustomerLanguage(
        'Hi Priya, my booking with Rajesh was confirmed for tomorrow morning',
      );
      expect(result.language).toBe('english');
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it('detects Hindi from a Hindi sentence', () => {
      const result = detectCustomerLanguage(
        'मुझे अपनी बुकिंग के बारे में बताइए क्या हुआ',
      );
      expect(result.language).toBe('hindi');
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it('detects Hinglish from mixed sentence', () => {
      const result = detectCustomerLanguage(
        'Driver late tha, please refund my booking amount',
      );
      expect(result.language).toBe('hinglish');
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it('returns unknown for short ambiguous words alone', () => {
      expect(detectCustomerLanguage('haan').language).toBe('unknown');
      expect(detectCustomerLanguage('yes').language).toBe('unknown');
      expect(detectCustomerLanguage('ji').language).toBe('unknown');
    });
  });

  describe('evaluatePreferredLanguageUpdate', () => {
    it('sets preferred language on first confident detection', () => {
      const detection = detectCustomerLanguage(
        'I need help with my cab booking from Delhi airport',
      );
      const result = evaluatePreferredLanguageUpdate('unknown', detection);
      expect(result.shouldUpdate).toBe(true);
      expect(result.newLanguage).toBe('english');
    });

    it('does not switch on haan alone after English conversation', () => {
      const detection = detectCustomerLanguage('haan');
      const result = evaluatePreferredLanguageUpdate('english', detection);
      expect(result.shouldUpdate).toBe(false);
      expect(result.skipReason).toBe('ambiguous_short_utterance');
      expect(result.newLanguage).toBe('english');
    });

    it('does not switch on yes alone after English conversation', () => {
      const detection = detectCustomerLanguage('yes');
      const result = evaluatePreferredLanguageUpdate('english', detection);
      expect(result.shouldUpdate).toBe(false);
      expect(result.skipReason).toBe('ambiguous_short_utterance');
    });

    it('switches to Hindi when customer clearly speaks Hindi', () => {
      const detection = detectCustomerLanguage(
        'मेरा ड्राइवर बहुत देर से आ रहा है कृपया मदद करें',
      );
      const result = evaluatePreferredLanguageUpdate('english', detection);
      expect(result.shouldUpdate).toBe(true);
      expect(result.newLanguage).toBe('hindi');
    });

    it('switches to Hinglish when customer clearly speaks Hinglish', () => {
      const detection = detectCustomerLanguage(
        'Driver bahut late hai, please help karo with refund',
      );
      const result = evaluatePreferredLanguageUpdate('english', detection);
      expect(result.shouldUpdate).toBe(true);
      expect(result.newLanguage).toBe('hinglish');
    });

    it('requires clear evidence before switching language', () => {
      const detection = detectCustomerLanguage('theek hai');
      const result = evaluatePreferredLanguageUpdate('english', detection);
      expect(result.shouldUpdate).toBe(false);
      expect(result.newLanguage).toBe('english');
    });
  });

  describe('resolveResponseLanguage', () => {
    it('prefers stable preferredLanguage over last detection', () => {
      expect(resolveResponseLanguage('english', 'hindi')).toBe('english');
    });

    it('falls back to lastCustomerLanguage when preferred is unknown', () => {
      expect(resolveResponseLanguage('unknown', 'hindi')).toBe('hindi');
    });
  });
});

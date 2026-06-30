import {
  assessCustomerUtteranceLanguage,
  createInitialLanguageLockState,
  detectCustomerLanguage,
  evaluatePreferredLanguageUpdate,
  isAmbiguousShortUtterance,
  resolveResponseLanguage,
  resolveResponseLanguageFromLock,
  updateLanguageLock,
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
      expect(['english', 'hinglish']).toContain(result.language);
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

    it('does not switch to Hindi from theek hai after English lock', () => {
      const detection = detectCustomerLanguage('theek hai');
      const result = evaluatePreferredLanguageUpdate('hinglish', detection);
      expect(result.shouldUpdate).toBe(false);
      expect(result.newLanguage).toBe('hinglish');
    });
  });

  describe('resolveResponseLanguage', () => {
    it('prefers stable preferredLanguage over last detection', () => {
      expect(resolveResponseLanguage('english', 'hindi')).toBe('english');
    });

    it('defaults to hinglish when preferred is unknown', () => {
      expect(resolveResponseLanguage('unknown', 'unknown')).toBe('hinglish');
    });
  });

  describe('conservative language lock', () => {
    it('defaults to english_hinglish at session start', () => {
      const state = createInitialLanguageLockState();
      expect(state.lockedLanguage).toBe('english_hinglish');
      expect(resolveResponseLanguageFromLock(state.lockedLanguage)).toBe(
        'hinglish',
      );
    });

    it('keeps English for English sentence with Hindi accent transcript', () => {
      const state = createInitialLanguageLockState();
      const assessment = assessCustomerUtteranceLanguage(
        'The driver arrived on time and the ride was comfortable',
      );
      const result = updateLanguageLock(state, assessment);

      expect(assessment.utteranceClass).toBe('english');
      expect(result.lockedLanguage).toBe('english_hinglish');
      expect(result.changed).toBe(false);
    });

    it('keeps English/Hinglish for "Yes ji, driver was good"', () => {
      const state = createInitialLanguageLockState();
      const assessment = assessCustomerUtteranceLanguage(
        'Yes ji, driver was good',
      );
      const result = updateLanguageLock(state, assessment);

      expect(assessment.utteranceClass).not.toBe('hindi');
      expect(result.lockedLanguage).toBe('english_hinglish');
    });

    it('keeps English/Hinglish for "Haan sir everything was fine"', () => {
      const state = createInitialLanguageLockState();
      const assessment = assessCustomerUtteranceLanguage(
        'Haan sir everything was fine',
      );
      const result = updateLanguageLock(state, assessment);

      expect(assessment.utteranceClass).not.toBe('hindi');
      expect(result.lockedLanguage).toBe('english_hinglish');
    });

    it('does not force pure Hindi for mixed Hinglish experience feedback', () => {
      const state = createInitialLanguageLockState();
      const assessment = assessCustomerUtteranceLanguage(
        'Mera experience achha tha, driver time par aaya',
      );
      const result = updateLanguageLock(state, assessment);

      expect(assessment.utteranceClass).toBe('hinglish');
      expect(result.lockedLanguage).toBe('english_hinglish');
    });

    it('locks Hindi for a clearly Hindi complaint sentence', () => {
      const state = createInitialLanguageLockState();
      const text =
        'Driver time par nahi aaya. Mujhe bahut problem hui. Aap complaint register karo.';
      const assessment = assessCustomerUtteranceLanguage(text);
      const result = updateLanguageLock(state, assessment);

      expect(assessment.utteranceClass).toBe('hindi');
      expect(result.lockedLanguage).toBe('hindi');
      expect(result.changed).toBe(true);
      expect(result.reason).toBe('strong_hindi_utterance');
    });

    it('locks Hindi after two consecutive primarily Hindi turns', () => {
      const state = createInitialLanguageLockState();
      updateLanguageLock(
        state,
        assessCustomerUtteranceLanguage(
          'I need help with my driver service booking',
        ),
      );

      updateLanguageLock(
        state,
        assessCustomerUtteranceLanguage('मुझे समस्या है'),
      );

      const third = updateLanguageLock(
        state,
        assessCustomerUtteranceLanguage('मुझे और मदद चाहिए'),
      );
      expect(third.lockedLanguage).toBe('hindi');
      expect(state.consecutivePrimaryHindiTurns).toBeGreaterThanOrEqual(2);
    });

    it('does not flip to Hindi from one Hindi filler while English/Hinglish is locked', () => {
      const state = createInitialLanguageLockState();
      updateLanguageLock(
        state,
        assessCustomerUtteranceLanguage('The driver was professional and on time'),
      );

      const filler = updateLanguageLock(
        state,
        assessCustomerUtteranceLanguage('haan'),
      );

      expect(filler.lockedLanguage).toBe('english_hinglish');
      expect(filler.reason).toBe('filler_or_ambiguous_utterance');
    });

    it('stays in Hindi once locked until multiple English turns', () => {
      const state = createInitialLanguageLockState();
      updateLanguageLock(
        state,
        assessCustomerUtteranceLanguage(
          'Driver time par nahi aaya. Mujhe bahut problem hui. Aap complaint register karo.',
        ),
      );
      expect(state.lockedLanguage).toBe('hindi');

      updateLanguageLock(
        state,
        assessCustomerUtteranceLanguage('Haan ji theek hai'),
      );
      expect(state.lockedLanguage).toBe('hindi');

      updateLanguageLock(
        state,
        assessCustomerUtteranceLanguage(
          'Please call me back tomorrow about my booking',
        ),
      );
      expect(state.lockedLanguage).toBe('hindi');

      const unlock = updateLanguageLock(
        state,
        assessCustomerUtteranceLanguage(
          'I want an update in English about my driver service booking',
        ),
      );
      expect(unlock.lockedLanguage).toBe('english_hinglish');
      expect(unlock.reason).toBe('consecutive_english_hinglish_turns');
    });
  });
});

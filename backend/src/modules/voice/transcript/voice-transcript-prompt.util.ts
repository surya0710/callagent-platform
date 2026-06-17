export {
  parseGlossaryTerms,
  buildGlossarySuffix,
  buildBilingualTranscriptionPrompt as buildRealtimeTranscriptionPrompt,
  buildBilingualTranscriptionPrompt as buildPostCallTranscriptionPrompt,
  buildBilingualPostProcessPrompt as buildPostProcessPrompt,
  resolveTranscriptionLanguageHint,
  detectTranscriptLanguage,
} from '../../../common/transcription/bilingual-transcription.util';

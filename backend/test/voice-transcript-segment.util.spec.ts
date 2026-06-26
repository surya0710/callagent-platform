import {
  resolveTranscriptSortKey,
  sortTranscriptSegments,
} from '../src/modules/voice/transcript/voice-transcript-segment.util';

describe('voice-transcript-segment.util', () => {
  it('orders segments by startedAtMs for turn-by-turn timeline', () => {
    const sorted = sortTranscriptSegments([
      { startedAtMs: 5000 },
      { startedAtMs: 1000 },
      { startedAtMs: 9000 },
    ]);

    expect(sorted.map((segment) => segment.startedAtMs)).toEqual([1000, 5000, 9000]);
  });

  it('falls back to createdAtMs when startedAtMs is missing', () => {
    expect(
      resolveTranscriptSortKey({ createdAtMs: 42 }, 0),
    ).toBe(42);
  });
});

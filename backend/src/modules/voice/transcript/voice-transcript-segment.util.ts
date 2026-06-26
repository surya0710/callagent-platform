import { VoiceTranscriptSegmentDto } from './voice-transcript.types';

type SortableTranscriptSegment = Pick<
  VoiceTranscriptSegmentDto,
  'startedAtMs' | 'endedAtMs'
> & { createdAtMs?: number };

export function resolveTranscriptSortKey(
  segment: SortableTranscriptSegment,
  fallbackIndex: number,
): number {
  if (typeof segment.startedAtMs === 'number') {
    return segment.startedAtMs;
  }
  if (typeof segment.endedAtMs === 'number') {
    return segment.endedAtMs;
  }
  if (typeof segment.createdAtMs === 'number') {
    return segment.createdAtMs;
  }
  return fallbackIndex;
}

export function sortTranscriptSegments<T extends SortableTranscriptSegment>(
  segments: T[],
): T[] {
  return segments
    .map((segment, index) => ({ segment, index }))
    .sort((left, right) => {
      const leftKey = resolveTranscriptSortKey(left.segment, left.index);
      const rightKey = resolveTranscriptSortKey(right.segment, right.index);
      if (leftKey !== rightKey) {
        return leftKey - rightKey;
      }
      return left.index - right.index;
    })
    .map(({ segment }) => segment);
}

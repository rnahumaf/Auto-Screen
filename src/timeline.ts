import type { ResolvedSpeedSegment, SpeedSegment } from "./types.js";

const EPSILON = 1e-9;

export function buildSpeedMap(durationSeconds: number, requested: SpeedSegment[] = []): ResolvedSpeedSegment[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new RangeError("A duração da captura deve ser positiva e finita.");
  }
  const sorted = [...requested].sort((a, b) => a.startSeconds - b.startSeconds);
  let previousEnd = 0;
  for (const segment of sorted) {
    if (!Number.isFinite(segment.startSeconds) || !Number.isFinite(segment.endSeconds)) {
      throw new RangeError("Os limites dos segmentos de velocidade devem ser finitos.");
    }
    if (segment.startSeconds < 0 || segment.endSeconds <= segment.startSeconds || segment.endSeconds > durationSeconds + EPSILON) {
      throw new RangeError("Segmento de velocidade fora da duração da captura.");
    }
    if (!Number.isFinite(segment.rate) || segment.rate < 0.25 || segment.rate > 8) {
      throw new RangeError("A velocidade deve ficar entre 0.25x e 8x.");
    }
    if (segment.startSeconds < previousEnd - EPSILON) {
      throw new RangeError("Segmentos de velocidade não podem se sobrepor.");
    }
    previousEnd = segment.endSeconds;
  }

  const complete: SpeedSegment[] = [];
  let cursor = 0;
  for (const segment of sorted) {
    if (segment.startSeconds > cursor + EPSILON) {
      complete.push({ startSeconds: cursor, endSeconds: segment.startSeconds, rate: 1 });
    }
    complete.push(segment);
    cursor = segment.endSeconds;
  }
  if (cursor < durationSeconds - EPSILON) {
    complete.push({ startSeconds: cursor, endSeconds: durationSeconds, rate: 1 });
  }
  if (complete.length === 0) complete.push({ startSeconds: 0, endSeconds: durationSeconds, rate: 1 });

  let outputCursor = 0;
  return complete.map((segment) => {
    const outputDuration = (segment.endSeconds - segment.startSeconds) / segment.rate;
    const resolved: ResolvedSpeedSegment = {
      ...segment,
      outputStartSeconds: outputCursor,
      outputEndSeconds: outputCursor + outputDuration,
    };
    outputCursor += outputDuration;
    return resolved;
  });
}

export function sourceToOutputTime(timeSeconds: number, map: ResolvedSpeedSegment[]): number {
  const segment = map.find((candidate) =>
    timeSeconds >= candidate.startSeconds - EPSILON && timeSeconds <= candidate.endSeconds + EPSILON,
  ) ?? map.at(-1);
  if (!segment) return timeSeconds;
  const clamped = Math.min(segment.endSeconds, Math.max(segment.startSeconds, timeSeconds));
  return segment.outputStartSeconds + (clamped - segment.startSeconds) / segment.rate;
}

export function outputDuration(map: ResolvedSpeedSegment[]): number {
  return map.at(-1)?.outputEndSeconds ?? 0;
}

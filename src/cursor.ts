import { writeFile } from "node:fs/promises";
import { projectPointToOutput, type CameraFrame } from "./camera.js";
import { escapeFilterPath } from "./captions.js";
import { sourceToOutputTime } from "./timeline.js";
import type { CaptureProject, RenderOptions, ResolvedSpeedSegment } from "./types.js";

interface TimedPoint {
  timeSeconds: number;
  x: number;
  y: number;
  anchored?: boolean;
}

interface CursorSpriteMetrics {
  width: number;
  height: number;
  hotspotX: number;
  hotspotY: number;
}

function number(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function piecewise(points: TimedPoint[], field: "x" | "y"): string {
  if (points.length === 1) return number(points[0]?.[field] ?? 0);
  const leaves = points.map((point, index) => {
    const current = points[index + 1];
    if (!current) return number(point[field]);
    const previous = point;
    const duration = current.timeSeconds - previous.timeSeconds;
    if (duration <= 0) return number(current[field]);
    const progress = `clip((t-${number(previous.timeSeconds)})/${number(duration)},0,1)`;
    return `${number(previous[field])}+(${number(current[field] - previous[field])})*(${progress})`;
  });
  const balanced = (start: number, end: number): string => {
    if (start === end) return leaves[start] as string;
    const middle = Math.floor((start + end) / 2);
    const threshold = points[middle + 1] as TimedPoint;
    return `if(lt(t,${number(threshold.timeSeconds)}),${balanced(start, middle)},${balanced(middle + 1, end)})`;
  };
  return balanced(0, leaves.length - 1);
}

function parseColor(value: string): { red: number; green: number; blue: number; alpha: number } {
  const match = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (!match?.[1]) throw new TypeError(`Cor inválida para indicador do cursor: ${value}.`);
  const hex = match[1];
  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
    alpha: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255,
  };
}

function simplifyTimedPoints(points: TimedPoint[], initialTolerance = 0.75, maximumPoints = 1_500): TimedPoint[] {
  if (points.length <= 2) return points;
  const simplify = (tolerance: number): TimedPoint[] => {
    const keep = new Set<number>([0, points.length - 1]);
    points.forEach((point, index) => { if (point.anchored) keep.add(index); });
    const stack: Array<[number, number]> = [[0, points.length - 1]];
    while (stack.length > 0) {
      const [startIndex, endIndex] = stack.pop() as [number, number];
      const start = points[startIndex] as TimedPoint;
      const end = points[endIndex] as TimedPoint;
      const duration = end.timeSeconds - start.timeSeconds;
      let maximumError = 0;
      let maximumIndex = -1;
      for (let index = startIndex + 1; index < endIndex; index += 1) {
        const point = points[index] as TimedPoint;
        const progress = duration <= 0 ? 0 : (point.timeSeconds - start.timeSeconds) / duration;
        const expectedX = start.x + (end.x - start.x) * progress;
        const expectedY = start.y + (end.y - start.y) * progress;
        const error = Math.hypot(point.x - expectedX, point.y - expectedY);
        if (error > maximumError) {
          maximumError = error;
          maximumIndex = index;
        }
      }
      if (maximumIndex >= 0 && maximumError > tolerance) {
        keep.add(maximumIndex);
        stack.push([startIndex, maximumIndex], [maximumIndex, endIndex]);
      }
    }
    return [...keep].sort((a, b) => a - b).map((index) => points[index] as TimedPoint);
  };
  let tolerance = initialTolerance;
  let simplified = simplify(tolerance);
  while (simplified.length > maximumPoints) {
    tolerance *= 1.5;
    simplified = simplify(tolerance);
  }
  return simplified;
}

function smoothTimedPoints(points: TimedPoint[], amount: number): TimedPoint[] {
  if (amount <= 0 || points.length < 3) return points;
  const timeConstant = 0.02 + amount * 0.16;
  const forward: TimedPoint[] = [points[0] as TimedPoint];
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index] as TimedPoint;
    const previousPoint = points[index - 1] as TimedPoint;
    const previous = forward[index - 1] as TimedPoint;
    if (point.anchored) {
      forward.push(point);
      continue;
    }
    const delta = Math.max(0, point.timeSeconds - previousPoint.timeSeconds);
    const alpha = 1 - Math.exp(-delta / timeConstant);
    forward.push({
      timeSeconds: point.timeSeconds,
      x: previous.x + (point.x - previous.x) * alpha,
      y: previous.y + (point.y - previous.y) * alpha,
    });
  }

  const backward: TimedPoint[] = new Array(points.length);
  backward[points.length - 1] = points.at(-1) as TimedPoint;
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const point = points[index] as TimedPoint;
    const nextPoint = points[index + 1] as TimedPoint;
    const next = backward[index + 1] as TimedPoint;
    if (point.anchored) {
      backward[index] = point;
      continue;
    }
    const delta = Math.max(0, nextPoint.timeSeconds - point.timeSeconds);
    const alpha = 1 - Math.exp(-delta / timeConstant);
    backward[index] = {
      timeSeconds: point.timeSeconds,
      x: next.x + (point.x - next.x) * alpha,
      y: next.y + (point.y - next.y) * alpha,
    };
  }

  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1 || point.anchored) return point;
    const before = forward[index] as TimedPoint;
    const after = backward[index] as TimedPoint;
    return {
      timeSeconds: point.timeSeconds,
      x: (before.x + after.x) / 2,
      y: (before.y + after.y) / 2,
      ...(point.anchored ? { anchored: true } : {}),
    };
  });
}

function finiteDetail(details: Record<string, unknown>, key: string): number | undefined {
  const value = details[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clickAnchors(
  project: CaptureProject, speedMap: ResolvedSpeedSegment[], frames: CameraFrame[], width: number, height: number,
): { points: TimedPoint[]; dragRanges: Array<{ start: number; end: number }> } {
  const points: TimedPoint[] = [];
  const dragRanges: Array<{ start: number; end: number }> = [];
  for (const action of project.actions) {
    if (action.type !== "click") continue;
    const x = finiteDetail(action.details, "x");
    const y = finiteDetail(action.details, "y");
    if (x === undefined || y === undefined) continue;
    const downTime = sourceToOutputTime(action.requestedAtSeconds, speedMap);
    const down = projectPointToOutput({ x, y }, downTime, frames, project.capture.bounds, width, height);
    points.push({ timeSeconds: downTime, ...down, anchored: true });

    const releaseX = finiteDetail(action.details, "releaseX");
    const releaseY = finiteDetail(action.details, "releaseY");
    if (releaseX === undefined || releaseY === undefined) continue;
    const upTime = sourceToOutputTime(action.actualAtSeconds, speedMap);
    const up = projectPointToOutput({ x: releaseX, y: releaseY }, upTime, frames, project.capture.bounds, width, height);
    points.push({ timeSeconds: upTime, ...up, anchored: true });
    if (upTime > downTime) dragRanges.push({ start: downTime, end: upTime });
  }
  return { points, dragRanges };
}

function mergeTimedPoints(points: TimedPoint[]): TimedPoint[] {
  const ordered = [...points].sort((a, b) => a.timeSeconds - b.timeSeconds || Number(Boolean(a.anchored)) - Number(Boolean(b.anchored)));
  const merged: TimedPoint[] = [];
  for (const point of ordered) {
    const previous = merged.at(-1);
    if (previous && Math.abs(point.timeSeconds - previous.timeSeconds) < 0.000_001) {
      if (point.anchored || !previous.anchored) merged[merged.length - 1] = point;
      continue;
    }
    merged.push(point);
  }
  return merged;
}

function outputPointerPath(
  project: CaptureProject, speedMap: ResolvedSpeedSegment[], frames: CameraFrame[], width: number, height: number, fps: number,
  smoothing: number,
): TimedPoint[] {
  const { points: anchors, dragRanges } = clickAnchors(project, speedMap, frames, width, height);
  const points: TimedPoint[] = [];
  for (const sample of project.pointerPath) {
    const timeSeconds = sourceToOutputTime(sample.timeSeconds, speedMap);
    const point = projectPointToOutput(sample, timeSeconds, frames, project.capture.bounds, width, height);
    const previous = points.at(-1);
    if (previous && timeSeconds <= previous.timeSeconds) continue;
    const anchored = dragRanges.some(({ start, end }) => timeSeconds >= start && timeSeconds <= end);
    points.push({ timeSeconds, ...point, anchored });
  }
  const smoothed = smoothTimedPoints(mergeTimedPoints([...points, ...anchors]), smoothing);
  return simplifyTimedPoints(smoothed, Math.max(0.5, 30 / fps));
}

function cursorSpriteMetrics(size: number): CursorSpriteMetrics {
  const scale = size / 56;
  const padding = Math.max(8, Math.ceil(size * 0.28));
  return {
    width: Math.ceil(56 * scale + padding * 2),
    height: Math.ceil(56 * scale + padding * 2),
    hotspotX: padding + 2 * scale,
    hotspotY: padding + 2 * scale,
  };
}

function cursorDrawing(size: number): string {
  const scale = size / 56;
  const padding = Math.max(8, Math.ceil(size * 0.28));
  const point = (x: number, y: number): string => `${Math.round((x - 8) * scale + padding)} ${Math.round((y - 8) * scale + padding)}`;
  return [
    `m ${point(13, 11)}`,
    `l ${point(56, 24)}`,
    `b ${point(64, 26)} ${point(64, 34)} ${point(57, 38)}`,
    `l ${point(38, 57)}`,
    `b ${point(34, 64)} ${point(26, 64)} ${point(24, 56)}`,
    `l ${point(11, 13)}`,
    `b ${point(8, 11)} ${point(11, 8)} ${point(13, 11)}`,
  ].join(" ");
}

export async function writeCursorSpriteAss(path: string, size: number): Promise<CursorSpriteMetrics> {
  const metrics = cursorSpriteMetrics(size);
  const drawing = cursorDrawing(size);
  const header = [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${metrics.width}`, `PlayResY: ${metrics.height}`,
    "ScaledBorderAndShadow: yes", "WrapStyle: 2", "", "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Cursor,Arial,16,&H00FFFFFF,&H00FFFFFF,&H00FFFFFF,&H00000000,0,0,0,0,100,100,0,0,1,1,0,7,0,0,0,1",
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events = [
    `Dialogue: 0,0:00:00.00,9:59:59.00,Cursor,,0,0,0,,{\\an7\\pos(3,-2)\\p1\\1a&HFF&\\3c&HFFF16C&\\3a&H72&\\bord6\\blur7}${drawing}{\\p0}`,
    `Dialogue: 0,0:00:00.00,9:59:59.00,Cursor,,0,0,0,,{\\an7\\pos(-3,4)\\p1\\1a&HFF&\\3c&HF0B4FF&\\3a&H68&\\bord7\\blur8}${drawing}{\\p0}`,
    `Dialogue: 1,0:00:00.00,9:59:59.00,Cursor,,0,0,0,,{\\an7\\pos(0,0)\\p1\\1c&HFFF9F4&\\1a&H08&\\3c&HFFF16C&\\3a&H28&\\bord2.4\\blur0.8}${drawing}{\\p0}`,
    `Dialogue: 2,0:00:00.00,9:59:59.00,Cursor,,0,0,0,,{\\an7\\pos(4,-3)\\p1\\1c&HFFF16C&\\1a&H70&\\bord0\\blur5}${drawing}{\\p0}`,
    `Dialogue: 2,0:00:00.00,9:59:59.00,Cursor,,0,0,0,,{\\an7\\pos(-4,5)\\p1\\1c&HF0B4FF&\\1a&H68&\\bord0\\blur6}${drawing}{\\p0}`,
    `Dialogue: 3,0:00:00.00,9:59:59.00,Cursor,,0,0,0,,{\\an7\\pos(0,0)\\p1\\1a&HFF&\\3c&HFFFFFF&\\3a&H20&\\bord1.2\\blur0.35}${drawing}{\\p0}`,
  ];
  await writeFile(path, `${[...header, ...events].join("\n")}\n`, "utf8");
  return metrics;
}

export function buildCursorFilters(
  project: CaptureProject,
  speedMap: ResolvedSpeedSegment[],
  frames: CameraFrame[],
  width: number,
  height: number,
  fps: number,
  durationSeconds: number,
  options: RenderOptions["cursor"],
  spriteAss?: { path: string; metrics: CursorSpriteMetrics },
  inputLabel = "camera",
  outputLabel = "cursorout",
): string[] {
  if (project.capture.cursorMode !== "software") return [`[${inputLabel}]null[${outputLabel}]`];
  const points = outputPointerPath(project, speedMap, frames, width, height, fps, options?.smoothing ?? 0);
  if (points.length === 0) return [`[${inputLabel}]null[${outputLabel}]`];
  const size = options?.size ?? Math.max(24, Math.round(height * 0.036));
  const x = piecewise(points, "x");
  const y = piecewise(points, "y");
  if (!spriteAss) throw new Error("O sprite vetorial do cursor não foi preparado.");
  const sprite = spriteAss.metrics;
  const lines = [
    `color=c=black:s=${sprite.width}x${sprite.height}:r=${fps}:d=${number(durationSeconds)},format=rgba,ass=filename='${escapeFilterPath(spriteAss.path)}',colorkey=black:0.035:0.12[cursorSprite]`,
    `[${inputLabel}][cursorSprite]overlay=x='${x}-${number(sprite.hotspotX)}':y='${y}-${number(sprite.hotspotY)}':eval=frame:eof_action=pass[cursorBase]`,
  ];
  const clickIndicator = options?.clickIndicator ?? true;
  const clickTimes = project.actions.filter((action) => action.type === "click")
    .map((action) => sourceToOutputTime(action.requestedAtSeconds, speedMap));
  if (!clickIndicator || clickTimes.length === 0) {
    lines.push(`[cursorBase]null[${outputLabel}]`);
    return lines;
  }
  const ringSize = Math.round(size * 1.8);
  const radius = ringSize * 0.38;
  const { red, green, blue, alpha } = parseColor(options?.clickColor ?? "#16B8F3CC");
  const enabled = clickTimes.map((time) => `between(t,${number(time)},${number(time + 0.22)})`).join("+");
  lines.push(
    `color=c=black@0.0:s=${ringSize}x${ringSize}:r=${fps}:d=${number(durationSeconds)},format=rgba,geq=r='${red}':g='${green}':b='${blue}':a='if(lt(abs(sqrt((X-W/2)*(X-W/2)+(Y-H/2)*(Y-H/2))-${number(radius)}),2.5),${alpha},0)'[clickSprite]`,
    `[cursorBase][clickSprite]overlay=x='${x}-${Math.round(ringSize / 2)}':y='${y}-${Math.round(ringSize / 2)}':eval=frame:eof_action=pass:enable='gt(${enabled},0)'[${outputLabel}]`,
  );
  return lines;
}

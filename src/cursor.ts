import { projectPointToOutput, type CameraFrame } from "./camera.js";
import { sourceToOutputTime } from "./timeline.js";
import type { CaptureProject, RenderOptions, ResolvedSpeedSegment } from "./types.js";

interface TimedPoint {
  timeSeconds: number;
  x: number;
  y: number;
}

function number(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function piecewise(points: TimedPoint[], field: "x" | "y"): string {
  if (points.length === 1) return number(points[0]?.[field] ?? 0);
  let expression = number(points.at(-1)?.[field] ?? 0);
  for (let index = points.length - 1; index >= 1; index -= 1) {
    const current = points[index] as TimedPoint;
    const previous = points[index - 1] as TimedPoint;
    const duration = current.timeSeconds - previous.timeSeconds;
    if (duration <= 0) continue;
    const progress = `clip((t-${number(previous.timeSeconds)})/${number(duration)},0,1)`;
    const interpolated = `${number(previous[field])}+(${number(current[field] - previous[field])})*(${progress})`;
    expression = `if(lt(t,${number(current.timeSeconds)}),${interpolated},${expression})`;
  }
  return expression;
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

function outputPointerPath(
  project: CaptureProject, speedMap: ResolvedSpeedSegment[], frames: CameraFrame[], width: number, height: number,
): TimedPoint[] {
  const points: TimedPoint[] = [];
  let lastTime = -Infinity;
  for (const sample of project.pointerPath) {
    const timeSeconds = sourceToOutputTime(sample.timeSeconds, speedMap);
    if (timeSeconds - lastTime < 0.1) continue;
    const point = projectPointToOutput(sample, timeSeconds, frames, project.capture.bounds, width, height);
    const previous = points.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 1.5) {
      points.push({ timeSeconds, ...point });
      lastTime = timeSeconds;
    }
  }
  const finalSample = project.pointerPath.at(-1);
  if (finalSample) {
    const timeSeconds = sourceToOutputTime(finalSample.timeSeconds, speedMap);
    const point = projectPointToOutput(finalSample, timeSeconds, frames, project.capture.bounds, width, height);
    const previous = points.at(-1);
    if (!previous || timeSeconds > previous.timeSeconds && Math.hypot(point.x - previous.x, point.y - previous.y) >= 1.5) {
      points.push({ timeSeconds, ...point });
    }
  }
  return points;
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
  inputLabel = "camera",
  outputLabel = "cursorout",
): string[] {
  if (project.capture.cursorMode !== "software") return [`[${inputLabel}]null[${outputLabel}]`];
  const points = outputPointerPath(project, speedMap, frames, width, height);
  if (points.length === 0) return [`[${inputLabel}]null[${outputLabel}]`];
  const size = options?.size ?? Math.max(24, Math.round(height * 0.036));
  const x = piecewise(points, "x");
  const y = piecewise(points, "y");
  const lines = [
    `color=c=black@0.0:s=${size}x${size}:r=${fps}:d=${number(durationSeconds)},format=rgba,geq=r='if(gte(X,2)*gte(Y,2)*lte(X-2,0.47*(Y-2))*lt(Y,0.68*H),255,0)':g='if(gte(X,2)*gte(Y,2)*lte(X-2,0.47*(Y-2))*lt(Y,0.68*H),255,0)':b='if(gte(X,2)*gte(Y,2)*lte(X-2,0.47*(Y-2))*lt(Y,0.68*H),255,0)':a='if(lte(X,0.56*Y)*lt(Y,0.78*H),255,0)'[cursorSprite]`,
    `[${inputLabel}][cursorSprite]overlay=x='${x}-2':y='${y}-2':eval=frame:eof_action=pass[cursorBase]`,
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

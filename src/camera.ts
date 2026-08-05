import { sourceToOutputTime } from "./timeline.js";
import { findWindow } from "./windows.js";
import type { CameraCue, CaptureProject, Point, Rect, ResolvedSpeedSegment } from "./types.js";

export interface CameraFrame extends Point {
  atSeconds: number;
  zoom: number;
  transitionSeconds: number;
}

export interface CameraPlan {
  filter: string;
  frames: CameraFrame[];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function center(rect: Rect, capture: Rect): Point {
  return { x: rect.x - capture.x + rect.width / 2, y: rect.y - capture.y + rect.height / 2 };
}

function fitZoom(rect: Rect, capture: Rect): number {
  return clamp(Math.min(capture.width / rect.width, capture.height / rect.height), 1, 4);
}

function number(value: number): string {
  return Number(value.toFixed(5)).toString();
}

function piecewise(frames: CameraFrame[], field: "x" | "y" | "zoom"): string {
  if (frames.length === 1) return number(frames[0]?.[field] ?? 1);
  let expression = number(frames.at(-1)?.[field] ?? 1);
  for (let index = frames.length - 1; index >= 1; index -= 1) {
    const current = frames[index] as CameraFrame;
    const previous = frames[index - 1] as CameraFrame;
    const start = current.atSeconds;
    const duration = current.transitionSeconds;
    const before = number(previous[field]);
    if (duration <= 0) expression = `if(lt(in_time,${number(start)}),${before},${expression})`;
    else {
      const end = start + duration;
      const delta = current[field] - previous[field];
      const progress = `(in_time-${number(start)})/${number(duration)}`;
      const smooth = `(${progress})*(${progress})*(3-2*(${progress}))`;
      const transition = `${before}+${number(delta)}*${smooth}`;
      expression = `if(lt(in_time,${number(start)}),${before},if(lt(in_time,${number(end)}),${transition},${expression}))`;
    }
  }
  return expression;
}

async function cueFrame(cue: CameraCue, project: CaptureProject): Promise<CameraFrame> {
  const capture = project.capture.bounds;
  let target: Point = { x: capture.width / 2, y: capture.height / 2 };
  let inferredZoom = 1;
  if (cue.target.kind === "region") {
    target = center(cue.target.rect, capture);
    inferredZoom = fitZoom(cue.target.rect, capture);
  } else if (cue.target.kind === "window") {
    const window = await findWindow(cue.target.title, cue.target.match);
    target = center(window.rect, capture);
    inferredZoom = fitZoom(window.rect, capture);
  }
  return {
    ...target,
    atSeconds: cue.atSeconds,
    zoom: clamp(cue.zoom ?? inferredZoom, 1, 4),
    transitionSeconds: cue.transition === "instant" ? 0 : (cue.transitionSeconds ?? 0.35),
  };
}

function deadZoneTarget(raw: Point, previous: Point, viewportWidth: number, viewportHeight: number): Point {
  const deadX = viewportWidth * 0.14;
  const deadY = viewportHeight * 0.14;
  let x = previous.x;
  let y = previous.y;
  if (raw.x < previous.x - deadX) x = raw.x + deadX;
  else if (raw.x > previous.x + deadX) x = raw.x - deadX;
  if (raw.y < previous.y - deadY) y = raw.y + deadY;
  else if (raw.y > previous.y + deadY) y = raw.y - deadY;
  return { x, y };
}

export function automaticCameraCues(project: CaptureProject, speedMap: ResolvedSpeedSegment[]): CameraCue[] {
  const firstAction = project.actions.find((action) =>
    (action.type === "click" || action.type === "scroll") &&
    typeof action.details.x === "number" && typeof action.details.y === "number",
  );
  if (!firstAction) return [];
  const focusAt = Math.max(0.35, sourceToOutputTime(firstAction.requestedAtSeconds, speedMap) - 0.35);
  return [
    { atSeconds: 0, target: { kind: "desktop" }, transition: "instant" },
    { atSeconds: focusAt, target: { kind: "pointer", smoothing: 0.28 }, zoom: 1.28, transition: "smooth", transitionSeconds: 0.45 },
  ];
}

export function cameraStateAt(frames: CameraFrame[], timeSeconds: number): CameraFrame {
  let previous = frames[0] as CameraFrame;
  for (let index = 1; index < frames.length; index += 1) {
    const current = frames[index] as CameraFrame;
    if (timeSeconds < current.atSeconds) return { ...previous, atSeconds: timeSeconds, transitionSeconds: 0 };
    const end = current.atSeconds + current.transitionSeconds;
    if (current.transitionSeconds > 0 && timeSeconds < end) {
      const linear = clamp((timeSeconds - current.atSeconds) / current.transitionSeconds, 0, 1);
      const progress = linear * linear * (3 - 2 * linear);
      return {
        x: previous.x + (current.x - previous.x) * progress,
        y: previous.y + (current.y - previous.y) * progress,
        zoom: previous.zoom + (current.zoom - previous.zoom) * progress,
        atSeconds: timeSeconds,
        transitionSeconds: 0,
      };
    }
    previous = current;
  }
  return { ...previous, atSeconds: timeSeconds, transitionSeconds: 0 };
}

export function projectPointToOutput(
  point: Point, timeSeconds: number, frames: CameraFrame[], capture: Rect, width: number, height: number,
): Point {
  const state = cameraStateAt(frames, timeSeconds);
  const viewportWidth = capture.width / state.zoom;
  const viewportHeight = capture.height / state.zoom;
  const left = clamp(state.x - viewportWidth / 2, 0, Math.max(0, capture.width - viewportWidth));
  const top = clamp(state.y - viewportHeight / 2, 0, Math.max(0, capture.height - viewportHeight));
  return {
    x: clamp((point.x - capture.x - left) * width / viewportWidth, 0, width),
    y: clamp((point.y - capture.y - top) * height / viewportHeight, 0, height),
  };
}

export async function buildCameraPlan(
  cues: CameraCue[], project: CaptureProject, speedMap: ResolvedSpeedSegment[], width: number, height: number, fps: number,
): Promise<CameraPlan> {
  const initial: CameraFrame = {
    x: project.capture.bounds.width / 2,
    y: project.capture.bounds.height / 2,
    atSeconds: 0,
    zoom: 1,
    transitionSeconds: 0,
  };
  if (cues.length === 0) {
    return {
      filter: `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
      frames: [initial],
    };
  }
  const ordered = [...cues].sort((a, b) => a.atSeconds - b.atSeconds);
  const duration = speedMap.at(-1)?.outputEndSeconds ?? 0;
  if (ordered.some((cue) => cue.atSeconds < 0 || cue.atSeconds > duration)) throw new RangeError("Cue de câmera fora da timeline final.");
  const frames: CameraFrame[] = [initial];

  for (let index = 0; index < ordered.length; index += 1) {
    const cue = ordered[index] as CameraCue;
    if (cue.target.kind !== "pointer") {
      frames.push(await cueFrame(cue, project));
      continue;
    }
    const end = ordered[index + 1]?.atSeconds ?? duration;
    const smoothing = cue.target.smoothing ?? 0.28;
    const zoom = clamp(cue.zoom ?? 1.35, 1, 4);
    let previous: Point = { x: frames.at(-1)?.x ?? initial.x, y: frames.at(-1)?.y ?? initial.y };
    let lastTime = -Infinity;
    for (const sample of project.pointerPath) {
      const outputTime = sourceToOutputTime(sample.timeSeconds, speedMap);
      if (outputTime < cue.atSeconds || outputTime >= end || outputTime - lastTime < 0.08) continue;
      const raw = { x: sample.x - project.capture.bounds.x, y: sample.y - project.capture.bounds.y };
      const target = deadZoneTarget(raw, previous, project.capture.bounds.width / zoom, project.capture.bounds.height / zoom);
      const smoothed = {
        x: previous.x + (target.x - previous.x) * smoothing,
        y: previous.y + (target.y - previous.y) * smoothing,
      };
      if (Math.hypot(smoothed.x - previous.x, smoothed.y - previous.y) >= 1 || lastTime === -Infinity) {
        frames.push({
          ...smoothed,
          atSeconds: outputTime,
          zoom,
          transitionSeconds: lastTime === -Infinity ? (cue.transition === "instant" ? 0 : (cue.transitionSeconds ?? 0.45)) : 0.12,
        });
      }
      previous = smoothed;
      lastTime = outputTime;
    }
  }

  frames.sort((a, b) => a.atSeconds - b.atSeconds);
  const deduplicated = frames.filter((frame, index) => index === frames.length - 1 || frame.atSeconds !== frames[index + 1]?.atSeconds);
  const zoom = piecewise(deduplicated, "zoom");
  const centerX = piecewise(deduplicated, "x");
  const centerY = piecewise(deduplicated, "y");
  const x = `max(0,min(iw-iw/zoom,(${centerX})-iw/zoom/2))`;
  const y = `max(0,min(ih-ih/zoom,(${centerY})-ih/zoom/2))`;
  return {
    filter: `zoompan=z='${zoom}':x='${x}':y='${y}':d=1:s=${width}x${height}:fps=${fps},setsar=1`,
    frames: deduplicated,
  };
}

export async function buildCameraFilter(
  cues: CameraCue[], project: CaptureProject, speedMap: ResolvedSpeedSegment[], width: number, height: number, fps: number,
): Promise<string> {
  return (await buildCameraPlan(cues, project, speedMap, width, height, fps)).filter;
}

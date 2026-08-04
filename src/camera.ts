import { sourceToOutputTime } from "./timeline.js";
import { findWindow } from "./windows.js";
import type { CameraCue, CaptureProject, Point, Rect, ResolvedSpeedSegment } from "./types.js";

interface CameraFrame extends Point {
  atSeconds: number;
  zoom: number;
  transitionSeconds: number;
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

export async function buildCameraFilter(
  cues: CameraCue[],
  project: CaptureProject,
  speedMap: ResolvedSpeedSegment[],
  width: number,
  height: number,
  fps: number,
): Promise<string> {
  if (cues.length === 0) {
    return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
  }
  const ordered = [...cues].sort((a, b) => a.atSeconds - b.atSeconds);
  const duration = speedMap.at(-1)?.outputEndSeconds ?? 0;
  if (ordered.some((cue) => cue.atSeconds < 0 || cue.atSeconds > duration)) throw new RangeError("Cue de câmera fora da timeline final.");
  const frames: CameraFrame[] = [{
    x: project.capture.bounds.width / 2,
    y: project.capture.bounds.height / 2,
    atSeconds: 0,
    zoom: 1,
    transitionSeconds: 0,
  }];

  for (let index = 0; index < ordered.length; index += 1) {
    const cue = ordered[index] as CameraCue;
    if (cue.target.kind !== "pointer") {
      frames.push(await cueFrame(cue, project));
      continue;
    }
    const end = ordered[index + 1]?.atSeconds ?? duration;
    const smoothing = cue.target.smoothing ?? 0.22;
    let previous: Point | undefined;
    let lastTime = -Infinity;
    for (const sample of project.pointerPath) {
      const outputTime = sourceToOutputTime(sample.timeSeconds, speedMap);
      if (outputTime < cue.atSeconds || outputTime >= end || outputTime - lastTime < 0.12) continue;
      const raw = { x: sample.x - project.capture.bounds.x, y: sample.y - project.capture.bounds.y };
      const smoothed = previous ? {
        x: previous.x + (raw.x - previous.x) * smoothing,
        y: previous.y + (raw.y - previous.y) * smoothing,
      } : raw;
      frames.push({
        ...smoothed,
        atSeconds: outputTime,
        zoom: clamp(cue.zoom ?? 1.6, 1, 4),
        transitionSeconds: cue.transition === "instant" ? 0 : Math.min(0.18, Math.max(0.05, outputTime - lastTime)),
      });
      previous = smoothed;
      lastTime = outputTime;
    }
    if (!previous) frames.push(await cueFrame({ ...cue, target: { kind: "desktop" } }, project));
  }

  frames.sort((a, b) => a.atSeconds - b.atSeconds);
  const deduplicated = frames.filter((frame, index) => index === frames.length - 1 || frame.atSeconds !== frames[index + 1]?.atSeconds);
  const zoom = piecewise(deduplicated, "zoom");
  const centerX = piecewise(deduplicated, "x");
  const centerY = piecewise(deduplicated, "y");
  const x = `max(0,min(iw-iw/zoom,(${centerX})-iw/zoom/2))`;
  const y = `max(0,min(ih-ih/zoom,(${centerY})-ih/zoom/2))`;
  return `zoompan=z='${zoom}':x='${x}':y='${y}':d=1:s=${width}x${height}:fps=${fps}`;
}

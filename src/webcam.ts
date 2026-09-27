import type { CaptureProject, ResolvedSpeedSegment } from "./types.js";

function number(value: number): string { return Number(value.toFixed(6)).toString(); }

function mask(size: number, fps: number, duration: number, label: string): string {
  const radius = number(size / 2 - 0.5);
  return `nullsrc=s=${size}x${size}:r=${fps}:d=${number(duration)},format=gray,` +
    `geq=lum='if(lte((X-W/2)*(X-W/2)+(Y-H/2)*(Y-H/2),${radius}*${radius}),255,0)'[${label}]`;
}

export function buildWebcamFilters(
  project: CaptureProject,
  speedMap: ResolvedSpeedSegment[],
  width: number,
  height: number,
  fps: number,
  outputDuration: number,
  expectedFrames: number,
): string[] {
  const webcam = project.webcam;
  if (!webcam) return ["[cursorout]null[webcamout]"];
  const fractions = { small: 0.18, medium: 0.25, large: 0.33 } as const;
  const shortestSide = Math.min(width, height);
  const margin = Math.max(8, Math.round(shortestSide * 0.025));
  const size = Math.min(shortestSide - margin * 2, Math.max(48, Math.round(shortestSide * fractions[webcam.layout.size])));
  const border = webcam.layout.border === "none" ? 0 : Math.max(2, Math.round(size * 0.04));
  const innerSize = size - border * 2;
  const lines: string[] = [];

  for (const [index, segment] of webcam.segments.entries()) {
    const inputIndex = index + 1;
    const start = Math.max(0, segment.startOffsetSeconds);
    const padStart = Math.max(0, -segment.startOffsetSeconds);
    const frames = Math.max(1, Math.round(segment.durationSeconds * fps));
    lines.push(
      `[${inputIndex}:v]trim=start=${number(start)},setpts=PTS-STARTPTS,` +
      `${padStart > 0 ? `tpad=start_mode=clone:start_duration=${number(padStart)},` : ""}` +
      `fps=${fps},tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${frames},` +
      `scale=${innerSize}:${innerSize}:force_original_aspect_ratio=increase,` +
      `crop=${innerSize}:${innerSize},setsar=1,setpts=PTS-STARTPTS[webcamSegment${index}]`,
    );
  }
  const segmentLabels = webcam.segments.map((_, index) => `[webcamSegment${index}]`).join("");
  lines.push(webcam.segments.length === 1
    ? "[webcamSegment0]null[webcamRaw]"
    : `${segmentLabels}concat=n=${webcam.segments.length}:v=1:a=0[webcamRaw]`);

  for (const [index, segment] of speedMap.entries()) {
    lines.push(
      `[webcamRaw]trim=start=${number(segment.startSeconds)}:end=${number(segment.endSeconds)},` +
      `setpts=(PTS-STARTPTS)/${number(segment.rate)}[webcamSpeed${index}]`,
    );
  }
  const speedLabels = speedMap.map((_, index) => `[webcamSpeed${index}]`).join("");
  lines.push(speedMap.length === 1
    ? "[webcamSpeed0]null[webcamSped]"
    : `${speedLabels}concat=n=${speedMap.length}:v=1:a=0[webcamSped]`);
  lines.push(
    `[webcamSped]tpad=stop_mode=clone:stop_duration=1,fps=${fps}:start_time=0,` +
    `trim=end_frame=${expectedFrames},setpts=PTS-STARTPTS,format=rgba[webcamSquare]`,
  );

  let imageLabel = "webcamSquare";
  if (webcam.layout.shape === "circle") {
    lines.push(mask(innerSize, fps, outputDuration + 1, "webcamInnerMask"));
    lines.push("[webcamSquare][webcamInnerMask]alphamerge[webcamCircle]");
    imageLabel = "webcamCircle";
  }
  if (border > 0) {
    const color = webcam.layout.border === "black" ? "0x000000" : `0x${webcam.layout.borderColor.slice(1)}`;
    lines.push(`color=c=${color}:s=${size}x${size}:r=${fps}:d=${number(outputDuration + 1)},format=rgba[webcamBorderColor]`);
    let borderLabel = "webcamBorderColor";
    if (webcam.layout.shape === "circle") {
      lines.push(mask(size, fps, outputDuration + 1, "webcamOuterMask"));
      lines.push("[webcamBorderColor][webcamOuterMask]alphamerge[webcamBorderCircle]");
      borderLabel = "webcamBorderCircle";
    }
    lines.push(`[${borderLabel}][${imageLabel}]overlay=x=${border}:y=${border}:format=auto:shortest=1[webcamDecorated]`);
    imageLabel = "webcamDecorated";
  }

  const [, horizontal = "center"] = webcam.layout.position === "center"
    ? ["center", "center"] : webcam.layout.position.split("-");
  const vertical = webcam.layout.position === "center" ? "center" : webcam.layout.position.split("-")[0];
  const x = horizontal === "left" ? String(margin) : horizontal === "right" ? `W-w-${margin}` : "(W-w)/2";
  const y = vertical === "top" ? String(margin) : vertical === "bottom" ? `H-h-${margin}` : "(H-h)/2";
  lines.push(`[cursorout][${imageLabel}]overlay=x='${x}':y='${y}':format=auto:eof_action=repeat,format=yuv420p[webcamout]`);
  return lines;
}

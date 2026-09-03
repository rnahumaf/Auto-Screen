import { dirname, join } from "node:path";
import { runProcess } from "./process.js";
import type { DoctorCheck, VideoCadence } from "./types.js";

export function resolveFfmpegPath(explicit?: string): string {
  return explicit ?? process.env.AUTO_SCREEN_FFMPEG_PATH ?? "ffmpeg";
}

export function resolveFfprobePath(ffmpegPath: string): string {
  if (ffmpegPath === "ffmpeg") return "ffprobe";
  const extension = process.platform === "win32" ? ".exe" : "";
  return join(dirname(ffmpegPath), `ffprobe${extension}`);
}

export interface MediaProbe {
  durationSeconds: number;
  streams: Array<{ codecType: string; codecName: string; width?: number; height?: number; sampleRate?: number }>;
}

export async function probeMedia(path: string, ffmpegPath = "ffmpeg"): Promise<MediaProbe> {
  const result = await runProcess(resolveFfprobePath(ffmpegPath), [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,sample_rate", "-of", "json", path,
  ]);
  const value = JSON.parse(result.stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; sample_rate?: string }>;
  };
  return {
    durationSeconds: Number(value.format?.duration ?? 0),
    streams: (value.streams ?? []).map((stream) => {
      const base = { codecType: stream.codec_type ?? "", codecName: stream.codec_name ?? "" };
      return {
        ...base,
        ...(stream.width === undefined ? {} : { width: stream.width }),
        ...(stream.height === undefined ? {} : { height: stream.height }),
        ...(stream.sample_rate === undefined ? {} : { sampleRate: Number(stream.sample_rate) }),
      };
    }),
  };
}

function rational(value: string | undefined): number {
  if (!value) return 0;
  const [numeratorText, denominatorText] = value.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText ?? 1);
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0 ? numerator / denominator : 0;
}

export async function probeVideoCadence(
  path: string,
  requestedFps: number,
  ffmpegPath = "ffmpeg",
  progress: { duplicatedFrames?: number; droppedFrames?: number } = {},
): Promise<VideoCadence> {
  const result = await runProcess(resolveFfprobePath(ffmpegPath), [
    "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_frames",
    "-show_entries", "stream=avg_frame_rate,nb_read_frames:frame=best_effort_timestamp_time", "-of", "json", path,
  ]);
  const value = JSON.parse(result.stdout) as {
    streams?: Array<{ avg_frame_rate?: string; nb_read_frames?: string }>;
    frames?: Array<{ best_effort_timestamp_time?: string }>;
  };
  const times = (value.frames ?? []).map((frame) => Number(frame.best_effort_timestamp_time)).filter(Number.isFinite);
  let maximumGapSeconds = 0;
  for (let index = 1; index < times.length; index += 1) {
    maximumGapSeconds = Math.max(maximumGapSeconds, (times[index] as number) - (times[index - 1] as number));
  }
  const stream = value.streams?.[0];
  const frameCount = Number(stream?.nb_read_frames ?? times.length);
  const measuredFps = rational(stream?.avg_frame_rate) ||
    (times.length > 1 ? (times.length - 1) / ((times.at(-1) as number) - (times[0] as number)) : 0);
  const maximumGapMs = maximumGapSeconds * 1_000;
  return {
    frameCount: Number.isFinite(frameCount) ? frameCount : times.length,
    measuredFps: Number(measuredFps.toFixed(6)),
    maximumGapMs: Number(maximumGapMs.toFixed(3)),
    duplicatedFrames: Math.max(0, Math.trunc(progress.duplicatedFrames ?? 0)),
    droppedFrames: Math.max(0, Math.trunc(progress.droppedFrames ?? 0)),
    constantFrameRate: times.length < 2 || maximumGapMs <= (1_000 / requestedFps) * 1.25,
  };
}

export async function checkFfmpeg(ffmpegPath = "ffmpeg"): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const version = await runProcess(ffmpegPath, ["-hide_banner", "-version"], { allowFailure: true });
  checks.push({ name: "ffmpeg", ok: version.code === 0, detail: version.stdout.split(/\r?\n/)[0] || version.stderr.trim() });
  if (version.code !== 0) return checks;

  const [devices, filters, encoders, hardware] = await Promise.all([
    runProcess(ffmpegPath, ["-hide_banner", "-devices"], { allowFailure: true }),
    runProcess(ffmpegPath, ["-hide_banner", "-filters"], { allowFailure: true }),
    runProcess(ffmpegPath, ["-hide_banner", "-encoders"], { allowFailure: true }),
    runProcess(ffmpegPath, ["-hide_banner", "-hwaccels"], { allowFailure: true }),
  ]);
  const deviceText = `${devices.stdout}\n${devices.stderr}`;
  const filterText = `${filters.stdout}\n${filters.stderr}`;
  const encoderText = `${encoders.stdout}\n${encoders.stderr}`;
  const hardwareText = `${hardware.stdout}\n${hardware.stderr}`;
  const capabilities = [
    ["gdigrab", deviceText.includes("gdigrab")],
    ["ddagrab", filterText.includes("ddagrab")],
    ["d3d11va", hardwareText.includes("d3d11va")],
    ["hwdownload", filterText.includes("hwdownload")],
    ["fps", /\bfps\b/.test(filterText)],
    ["zoompan", filterText.includes("zoompan")],
    ["overlay/geq", filterText.includes(" overlay ") && filterText.includes(" geq ")],
    ["crop/scale", filterText.includes(" crop ") && filterText.includes(" scale ")],
    ["subtitles/ass", filterText.includes("subtitles") && filterText.includes(" ass ")],
    ["setpts", filterText.includes("setpts")],
    ["amix", filterText.includes("amix")],
    ["loudnorm", filterText.includes("loudnorm")],
    ["libx264", encoderText.includes("libx264")],
    ["aac", /\baac\b/.test(encoderText)],
  ] as const;
  for (const [name, ok] of capabilities) checks.push({ name, ok, detail: ok ? "disponível" : "não encontrado" });
  return checks;
}

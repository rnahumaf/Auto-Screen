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
  streams: Array<{ codecType: string; codecName: string; width?: number; height?: number; sampleRate?: number; startTimeSeconds?: number; durationSeconds?: number }>;
}

function parseDurationTag(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parts = value.split(":");
  if (parts.length !== 3) return undefined;
  const duration = Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

export async function probeMedia(path: string, ffmpegPath = "ffmpeg"): Promise<MediaProbe> {
  const result = await runProcess(resolveFfprobePath(ffmpegPath), [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,sample_rate,start_time,duration:stream_tags=DURATION", "-of", "json", path,
  ]);
  const value = JSON.parse(result.stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; sample_rate?: string; start_time?: string; duration?: string; tags?: { DURATION?: string } }>;
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
        ...(stream.start_time === undefined || !Number.isFinite(Number(stream.start_time)) ? {} : { startTimeSeconds: Number(stream.start_time) }),
        ...(() => {
          const duration = Number(stream.duration ?? NaN);
          const tagEnd = parseDurationTag(stream.tags?.DURATION);
          const start = Number(stream.start_time ?? 0);
          // Matroska DURATION tags contain the stream end timestamp, not its span.
          const measured = Number.isFinite(duration) ? duration : tagEnd === undefined ? undefined
            : Math.max(0, tagEnd - (Number.isFinite(start) ? start : 0));
          return measured === undefined ? {} : { durationSeconds: measured };
        })(),
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
  let timestampCount = 0;
  let firstTime = 0;
  let lastTime = 0;
  let maximumGapSeconds = 0;
  let reportedFrameCount = Number.NaN;
  let reportedFps = 0;
  // A saída por quadro pode exceder o trecho que runProcess guarda para diagnóstico.
  await runProcess(resolveFfprobePath(ffmpegPath), [
    "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_frames",
    "-show_entries", "stream=avg_frame_rate,nb_read_frames:frame=best_effort_timestamp_time", "-of", "flat", path,
  ], {
    onStdoutLine: (line) => {
      const [key, rawValue] = line.split("=", 2);
      if (!key || !rawValue) return;
      const value = rawValue.replace(/^"|"$/g, "");
      if (key === "streams.stream.0.avg_frame_rate") {
        reportedFps = rational(value);
      } else if (key === "streams.stream.0.nb_read_frames") {
        reportedFrameCount = Number(value);
      } else if (key.startsWith("frames.frame.") && key.endsWith(".best_effort_timestamp_time")) {
        const time = Number(value);
        if (!Number.isFinite(time)) return;
        if (timestampCount === 0) firstTime = time;
        else maximumGapSeconds = Math.max(maximumGapSeconds, time - lastTime);
        lastTime = time;
        timestampCount += 1;
      }
    },
  });
  const measuredFps = reportedFps || (timestampCount > 1 && lastTime > firstTime ? (timestampCount - 1) / (lastTime - firstTime) : 0);
  const maximumGapMs = maximumGapSeconds * 1_000;
  return {
    frameCount: Number.isFinite(reportedFrameCount) ? reportedFrameCount : timestampCount,
    measuredFps: Number(measuredFps.toFixed(6)),
    maximumGapMs: Number(maximumGapMs.toFixed(3)),
    duplicatedFrames: Math.max(0, Math.trunc(progress.duplicatedFrames ?? 0)),
    droppedFrames: Math.max(0, Math.trunc(progress.droppedFrames ?? 0)),
    constantFrameRate: timestampCount < 2 || maximumGapMs <= (1_000 / requestedFps) * 1.25,
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
    ["sendcmd", filterText.includes(" sendcmd ")],
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

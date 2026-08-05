import { dirname, join } from "node:path";
import { runProcess } from "./process.js";
import type { DoctorCheck } from "./types.js";

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

export async function checkFfmpeg(ffmpegPath = "ffmpeg"): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const version = await runProcess(ffmpegPath, ["-hide_banner", "-version"], { allowFailure: true });
  checks.push({ name: "ffmpeg", ok: version.code === 0, detail: version.stdout.split(/\r?\n/)[0] || version.stderr.trim() });
  if (version.code !== 0) return checks;

  const [devices, filters, encoders] = await Promise.all([
    runProcess(ffmpegPath, ["-hide_banner", "-devices"], { allowFailure: true }),
    runProcess(ffmpegPath, ["-hide_banner", "-filters"], { allowFailure: true }),
    runProcess(ffmpegPath, ["-hide_banner", "-encoders"], { allowFailure: true }),
  ]);
  const deviceText = `${devices.stdout}\n${devices.stderr}`;
  const filterText = `${filters.stdout}\n${filters.stderr}`;
  const encoderText = `${encoders.stdout}\n${encoders.stderr}`;
  const capabilities = [
    ["gdigrab", deviceText.includes("gdigrab")],
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

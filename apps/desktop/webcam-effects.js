import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { access } from "node:fs/promises";
import { probeMedia } from "./runtime/index.js";

const ffmpegPath = () => process.env.AUTO_SCREEN_FFMPEG_PATH ?? "ffmpeg";

async function remux(source, output) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(ffmpegPath(), [
      "-y", "-hide_banner", "-loglevel", "error", "-i", source,
      "-map", "0:v:0", "-an", "-c:v", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", output,
    ], { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let diagnostic = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { diagnostic = `${diagnostic}${chunk}`.slice(-4_096); });
    child.once("error", rejectPromise);
    child.once("close", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`Falha ao preparar a webcam: ${diagnostic.trim()}`)));
  });
}

export async function normalizeProcessedWebcam(source, output) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(ffmpegPath(), [
      "-y", "-hide_banner", "-loglevel", "error", "-i", source,
      "-map", "0:v:0", "-an", "-c:v", "copy", output,
    ], { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let diagnostic = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { diagnostic = `${diagnostic}${chunk}`.slice(-4_096); });
    child.once("error", rejectPromise);
    child.once("close", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`Falha ao finalizar o filtro da webcam: ${diagnostic.trim()}`)));
  });
  const probe = await probeMedia(output, ffmpegPath());
  if (!probe.streams.some((stream) => stream.codecType === "video") || probe.durationSeconds <= 0) {
    throw new Error("O filtro da webcam não produziu vídeo válido.");
  }
  return output;
}

export async function prepareWebcamEffects(project) {
  if (!project?.webcam || !(project.webcam.layout.backgroundBlur || project.webcam.layout.faceRetouch)) return [];
  const sources = [];
  for (const [index, segment] of project.webcam.segments.entries()) {
    const input = join(project.workDirectory, `webcam-effects-input-${index}.mp4`);
    const output = join(project.workDirectory, `webcam-effects-output-${index}.webm`);
    await remux(segment.path, input);
    const probe = await probeMedia(input, ffmpegPath());
    if (!probe.streams.some((stream) => stream.codecType === "video") || probe.durationSeconds <= 0) {
      throw new Error("O segmento da webcam não contém vídeo válido.");
    }
    sources.push({ index, input, output, durationSeconds: probe.durationSeconds });
  }
  return sources;
}

export async function applyWebcamEffects(project, processed) {
  if (!project?.webcam || !Array.isArray(processed) || processed.length !== project.webcam.segments.length) {
    throw new Error("O resultado dos filtros da webcam está incompleto.");
  }
  const paths = [];
  for (const [index, path] of processed.entries()) {
    const expected = join(project.workDirectory, `webcam-effects-output-${index}.webm`);
    if (path !== expected) throw new Error("O arquivo filtrado não pertence à gravação atual.");
    await access(path);
    const normalized = join(project.workDirectory, `webcam-effects-final-${index}.mkv`);
    await normalizeProcessedWebcam(path, normalized);
    await validateProcessedWebcamTiming(project.webcam.segments[index].path, normalized);
    paths.push(normalized);
  }
  project.webcam.segments.forEach((segment, index) => { segment.path = paths[index]; });
  return project;
}

async function videoTimeline(path) {
  const executable = ffmpegPath() === "ffmpeg" ? "ffprobe" : join(dirname(ffmpegPath()), "ffprobe.exe");
  const frames = await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, ["-v", "error", "-select_streams", "v:0", "-show_frames",
      "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", path],
    { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let error = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { error = `${error}${chunk}`.slice(-2_000); });
    child.once("error", rejectPromise);
    child.once("close", (code) => {
      if (code !== 0) { rejectPromise(new Error(`Falha ao conferir os tempos da webcam: ${error.trim()}`)); return; }
      try { resolvePromise(JSON.parse(output).frames ?? []); } catch (cause) { rejectPromise(cause); }
    });
  });
  const times = frames.map((frame) => Number(frame.best_effort_timestamp_time));
  if (!times.length || times.some((time, index) => !Number.isFinite(time) || (index > 0 && time <= times[index - 1]))) {
    throw new Error("A webcam possui timestamps ausentes ou fora de ordem.");
  }
  const probe = await probeMedia(path, ffmpegPath());
  const video = probe.streams.find((stream) => stream.codecType === "video");
  return { times: times.map((time) => time - times[0]), durationSeconds: video?.durationSeconds ?? probe.durationSeconds };
}

export async function validateProcessedWebcamTiming(original, processed) {
  const [before, after] = await Promise.all([videoTimeline(original), videoTimeline(processed)]);
  // Matroska/WebM timestamps have millisecond precision; allow only mux rounding.
  if (before.times.length !== after.times.length || Math.abs(before.durationSeconds - after.durationSeconds) > 0.003 ||
      before.times.some((time, index) => Math.abs(time - after.times[index]) > 0.002)) {
    throw new Error("O filtro alterou os timestamps ou a duração da webcam. O segmento original foi preservado.");
  }
  return { frameCount: after.times.length, durationSeconds: after.durationSeconds };
}

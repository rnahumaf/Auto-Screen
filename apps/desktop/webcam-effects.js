import { spawn } from "node:child_process";
import { join } from "node:path";
import { access } from "node:fs/promises";
import { probeMedia } from "./runtime/index.js";

const ffmpegPath = () => process.env.AUTO_SCREEN_FFMPEG_PATH ?? "ffmpeg";

async function remux(source, output) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(ffmpegPath(), [
      "-y", "-hide_banner", "-loglevel", "error", "-i", source,
      "-map", "0:v:0", "-an", "-c:v", "copy", "-movflags", "+faststart", output,
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
    paths.push(await normalizeProcessedWebcam(path, normalized));
  }
  project.webcam.segments.forEach((segment, index) => { segment.path = paths[index]; });
  return project;
}

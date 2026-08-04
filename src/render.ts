import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { audioFilterGraph, audioInputArguments, prepareAudioTracks } from "./audio.js";
import { buildCameraFilter } from "./camera.js";
import { escapeFilterPath, writeAssFile } from "./captions.js";
import { probeMedia, resolveFfmpegPath } from "./ffmpeg.js";
import { runProcess } from "./process.js";
import { cleanupScreenProject } from "./recorder.js";
import { buildSpeedMap, outputDuration } from "./timeline.js";
import type { CaptureProject, RenderOptions, RenderResult, ScreenManifest } from "./types.js";

function speedFilterGraph(map: ReturnType<typeof buildSpeedMap>): string[] {
  const lines = map.map((segment, index) =>
    `[0:v]trim=start=${segment.startSeconds}:end=${segment.endSeconds},setpts=(PTS-STARTPTS)/${segment.rate}[speed${index}]`,
  );
  if (map.length === 1) lines.push("[speed0]null[sped]");
  else lines.push(`${map.map((_, index) => `[speed${index}]`).join("")}concat=n=${map.length}:v=1:a=0[sped]`);
  return lines;
}

export async function renderScreenProject(project: CaptureProject, options: RenderOptions): Promise<RenderResult> {
  if (project.schemaVersion !== 1 || project.platform !== "win32") throw new TypeError("Projeto de captura incompatível.");
  const outPrefix = resolve(options.outPrefix);
  await mkdir(dirname(outPrefix), { recursive: true });
  const videoPath = `${outPrefix}.mp4`;
  const manifestPath = `${outPrefix}.json`;
  const width = options.width ?? 1_920;
  const height = options.height ?? 1_080;
  const fps = options.fps ?? 30;
  for (const [name, value] of Object.entries({ width, height, fps })) {
    if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} deve ser um inteiro positivo.`);
  }
  const ffmpeg = resolveFfmpegPath(options.ffmpegPath);
  const speedMap = buildSpeedMap(project.rawDurationSeconds, options.speed);
  const finalDuration = outputDuration(speedMap);
  const captions = options.captions ?? [];
  const camera = options.camera ?? [];
  const keepIntermediates = options.keepIntermediates ?? false;
  const workDirectory = resolve(project.workDirectory);
  const outputRelativeToWork = relative(workDirectory, videoPath);
  const outputInsideWork = outputRelativeToWork === "" ||
    (!outputRelativeToWork.startsWith(`..${sep}`) && outputRelativeToWork !== ".." && !isAbsolute(outputRelativeToWork));
  if (!keepIntermediates && outputInsideWork) {
    throw new Error("A saída não pode ficar dentro do diretório temporário quando keepIntermediates é false.");
  }
  if (width % 2 !== 0 || height % 2 !== 0) throw new RangeError("width e height precisam ser pares para H.264 yuv420p.");
  if (captions.length > 1_000 || camera.length > 10_000 || (options.audio?.length ?? 0) > 64) throw new RangeError("A renderização excede os limites de eventos do MVP.");
  for (const caption of captions) {
    if (caption.startSeconds < 0 || caption.endSeconds <= caption.startSeconds || caption.endSeconds > finalDuration) throw new RangeError("Legenda fora da timeline final.");
  }
  for (const cue of camera) {
    if (cue.zoom !== undefined && (cue.zoom < 1 || cue.zoom > 4)) throw new RangeError("O zoom deve ficar entre 1 e 4.");
  }
  for (const track of options.audio ?? []) {
    const start = track.startSeconds ?? 0;
    const volume = track.volume ?? 1;
    if (!Number.isFinite(start) || start < 0 || start >= finalDuration) throw new RangeError("Faixa de áudio fora da timeline final.");
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new RangeError("O volume deve ficar entre 0 e 1.");
  }
  const assPath = join(project.workDirectory, "captions.ass");
  if (captions.length > 0) await writeAssFile(assPath, captions, width, height);
  const preparedAudio = await prepareAudioTracks(options.audio ?? [], project.workDirectory, ffmpeg, keepIntermediates);
  const cameraFilter = await buildCameraFilter(camera, project, speedMap, width, height, fps);
  const graph = speedFilterGraph(speedMap);
  graph.push(`[sped]${cameraFilter}[camera]`);
  graph.push(captions.length > 0 ? `[camera]ass=filename='${escapeFilterPath(assPath)}'[vout]` : "[camera]null[vout]");
  graph.push(...audioFilterGraph(preparedAudio, finalDuration));
  const graphPath = join(project.workDirectory, "filtergraph.txt");
  await writeFile(graphPath, graph.join(";\n"), "utf8");
  const args = [
    "-y", "-hide_banner", "-loglevel", "warning", "-i", project.rawVideoPath,
    ...audioInputArguments(preparedAudio, finalDuration),
    "-filter_complex_script", graphPath,
    "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", String(finalDuration), videoPath,
  ];
  try {
    await runProcess(ffmpeg, args);
  } catch (error) {
    throw new Error(`Falha ao compor o vídeo. Intermediários preservados em ${project.workDirectory}. ${error instanceof Error ? error.message : String(error)}`);
  }
  const outputProbe = await probeMedia(videoPath, ffmpeg);
  const videoStream = outputProbe.streams.find((stream) => stream.codecType === "video");
  const audioStream = outputProbe.streams.find((stream) => stream.codecType === "audio");
  if (videoStream?.codecName !== "h264" || audioStream?.codecName !== "aac") {
    throw new Error("O arquivo final não contém os streams H.264/AAC esperados.");
  }
  const manifest: ScreenManifest = {
    schemaVersion: 1,
    platform: "win32",
    createdAt: new Date().toISOString(),
    capture: { ...project.capture, rawDurationSeconds: project.rawDurationSeconds },
    output: {
      videoPath,
      width,
      height,
      fps,
      durationSeconds: outputProbe.durationSeconds,
      videoCodec: "h264",
      audioCodec: "aac",
    },
    actions: project.actions,
    pointerPath: project.pointerPath,
    marks: project.marks,
    speed: speedMap,
    camera,
    captions,
    audio: preparedAudio.map((track) => track.manifest),
    warnings: [...project.warnings],
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  if (!keepIntermediates) {
    try { await cleanupScreenProject(project); }
    catch (error) {
      manifest.warnings.push(`Não foi possível remover intermediários: ${error instanceof Error ? error.message : String(error)}`);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    }
  }
  return { videoPath, manifestPath, manifest };
}

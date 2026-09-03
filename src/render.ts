import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { audioFilterGraph, audioInputArguments, prepareAudioTracks } from "./audio.js";
import { automaticCameraCues, buildCameraPlan } from "./camera.js";
import { resolveAutomaticCaptionAnchors, escapeFilterPath, writeAssFile } from "./captions.js";
import { buildCursorFilters, writeCursorSpriteAss } from "./cursor.js";
import { probeMedia, probeVideoCadence, resolveFfmpegPath } from "./ffmpeg.js";
import { runProcess } from "./process.js";
import { cleanupScreenProject } from "./recorder.js";
import { buildSpeedMap, outputDuration } from "./timeline.js";
import { validateCaptureProject, validateRenderOptions } from "./validation.js";
import type { CaptureProject, RenderOptions, RenderResult, ScreenManifest } from "./types.js";

function speedFilterGraph(map: ReturnType<typeof buildSpeedMap>): string[] {
  const lines = map.map((segment, index) =>
    `[0:v]trim=start=${segment.startSeconds}:end=${segment.endSeconds},setpts=(PTS-STARTPTS)/${segment.rate}[speed${index}]`,
  );
  if (map.length === 1) lines.push("[speed0]null[sped]");
  else lines.push(`${map.map((_, index) => `[speed${index}]`).join("")}concat=n=${map.length}:v=1:a=0[sped]`);
  return lines;
}

async function renameIfPresent(source: string, destination: string): Promise<boolean> {
  try {
    await rename(source, destination);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function publishValidatedPair(
  stagingVideoPath: string,
  stagingManifestPath: string,
  videoPath: string,
  manifestPath: string,
  token: string,
): Promise<void> {
  const videoBackup = `${videoPath}.auto-screen-backup-${token}`;
  const manifestBackup = `${manifestPath}.auto-screen-backup-${token}`;
  let hadVideo = false;
  let hadManifest = false;
  let publishedVideo = false;
  let publishedManifest = false;
  try {
    hadVideo = await renameIfPresent(videoPath, videoBackup);
    try { hadManifest = await renameIfPresent(manifestPath, manifestBackup); }
    catch (error) {
      if (hadVideo) await rename(videoBackup, videoPath);
      throw error;
    }
    await rename(stagingVideoPath, videoPath);
    publishedVideo = true;
    await rename(stagingManifestPath, manifestPath);
    publishedManifest = true;
    await Promise.all([rm(videoBackup, { force: true }), rm(manifestBackup, { force: true })]);
  } catch (error) {
    if (publishedManifest) await rm(manifestPath, { force: true });
    if (publishedVideo) await rm(videoPath, { force: true });
    if (hadVideo) await renameIfPresent(videoBackup, videoPath);
    if (hadManifest) await renameIfPresent(manifestBackup, manifestPath);
    throw error;
  }
}

export async function renderScreenProject(projectInput: CaptureProject, optionsInput: RenderOptions): Promise<RenderResult> {
  const project = validateCaptureProject(projectInput);
  const options = validateRenderOptions(optionsInput);
  const outPrefix = resolve(options.outPrefix);
  await mkdir(dirname(outPrefix), { recursive: true });
  const videoPath = `${outPrefix}.mp4`;
  const manifestPath = `${outPrefix}.json`;
  const stagingToken = randomUUID();
  const stagingVideoPath = `${outPrefix}.auto-screen-${stagingToken}.mp4`;
  const stagingManifestPath = `${outPrefix}.auto-screen-${stagingToken}.json`;
  const renderDirectory = await mkdtemp(join(project.workDirectory, "render-"));
  const width = options.width ?? 1_920;
  const height = options.height ?? 1_080;
  const fps = options.fps ?? 60;
  for (const [name, value] of Object.entries({ width, height, fps })) {
    if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} deve ser um inteiro positivo.`);
  }
  const ffmpeg = resolveFfmpegPath(options.ffmpegPath);
  const speedMap = buildSpeedMap(project.rawDurationSeconds, options.speed);
  const finalDuration = outputDuration(speedMap);
  const expectedFrames = Math.round(finalDuration * fps);
  const cursorMode = project.capture.cursorMode;
  const normalizedProject: CaptureProject = project;
  const requestedCaptions = options.captions ?? [];
  const cameraGenerated = options.camera === undefined;
  const camera = options.camera ?? automaticCameraCues(normalizedProject, speedMap);
  const keepIntermediates = options.keepIntermediates ?? false;
  const workDirectory = resolve(project.workDirectory);
  const outputRelativeToWork = relative(workDirectory, videoPath);
  const outputInsideWork = outputRelativeToWork === "" ||
    (!outputRelativeToWork.startsWith(`..${sep}`) && outputRelativeToWork !== ".." && !isAbsolute(outputRelativeToWork));
  if (!keepIntermediates && outputInsideWork) {
    throw new Error("A saída não pode ficar dentro do diretório temporário quando keepIntermediates é false.");
  }
  if (width % 2 !== 0 || height % 2 !== 0) throw new RangeError("width e height precisam ser pares para H.264 yuv420p.");
  if (requestedCaptions.length > 1_000 || camera.length > 10_000 || (options.audio?.length ?? 0) > 64) throw new RangeError("A renderização excede os limites de eventos do MVP.");
  for (const caption of requestedCaptions) {
    if (caption.startSeconds < 0 || caption.endSeconds <= caption.startSeconds || caption.endSeconds > finalDuration) throw new RangeError("Legenda fora da timeline final.");
  }
  const captions = resolveAutomaticCaptionAnchors(requestedCaptions, normalizedProject, speedMap);
  for (const cue of camera) {
    if (cue.zoom !== undefined && (cue.zoom < 1 || cue.zoom > 4)) throw new RangeError("O zoom deve ficar entre 1 e 4.");
  }
  for (const track of options.audio ?? []) {
    const start = track.startSeconds ?? 0;
    const volume = track.volume ?? 1;
    if (!Number.isFinite(start) || start < 0 || start >= finalDuration) throw new RangeError("Faixa de áudio fora da timeline final.");
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new RangeError("O volume deve ficar entre 0 e 1.");
  }
  const assPath = join(renderDirectory, "captions.ass");
  if (captions.length > 0) await writeAssFile(assPath, captions, width, height);
  const preparedAudio = await prepareAudioTracks(options.audio ?? [], renderDirectory, ffmpeg, keepIntermediates);
  const cameraPlan = await buildCameraPlan(camera, normalizedProject, speedMap, width, height, fps);
  const cursorSize = options.cursor?.size ?? Math.max(24, Math.round(height * 0.036));
  const cursorAssPath = join(renderDirectory, "cursor.ass");
  const cursorSprite = cursorMode === "software"
    ? { path: cursorAssPath, metrics: await writeCursorSpriteAss(cursorAssPath, cursorSize) }
    : undefined;
  const graph = speedFilterGraph(speedMap);
  graph.push(
    `[sped]tpad=stop_mode=clone:stop_duration=${1 / fps},` +
    `fps=fps=${fps}:start_time=0,trim=end_frame=${expectedFrames},setpts=PTS-STARTPTS[timed]`,
  );
  graph.push(`[timed]${cameraPlan.filter}[camera]`);
  graph.push(...buildCursorFilters(normalizedProject, speedMap, cameraPlan.frames, width, height, fps, finalDuration, options.cursor, cursorSprite));
  graph.push(captions.length > 0 ? `[cursorout]ass=filename='${escapeFilterPath(assPath)}'[vout]` : "[cursorout]null[vout]");
  graph.push(...audioFilterGraph(preparedAudio, finalDuration));
  const graphPath = join(renderDirectory, "filtergraph.txt");
  await writeFile(graphPath, graph.join(";\n"), "utf8");
  const args = [
    "-y", "-hide_banner", "-loglevel", "warning", "-i", project.rawVideoPath,
    ...audioInputArguments(preparedAudio, finalDuration),
    "-/filter_complex", graphPath,
    "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "medium", "-crf", "17",
    "-pix_fmt", "yuv420p", "-fps_mode", "cfr", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
    "-t", String(finalDuration), stagingVideoPath,
  ];
  try {
    await runProcess(ffmpeg, args, options.abortSignal === undefined ? {} : {
      abortSignal: options.abortSignal,
      gracefulAbortInput: "q\n",
      gracefulAbortTimeoutMs: 1_500,
    });
  } catch (error) {
    await rm(stagingVideoPath, { force: true }).catch(() => undefined);
    throw new Error(`Falha ao compor o vídeo. Intermediários preservados em ${project.workDirectory}. ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const outputProbe = await probeMedia(stagingVideoPath, ffmpeg);
    const outputCadence = await probeVideoCadence(stagingVideoPath, fps, ffmpeg);
    const videoStream = outputProbe.streams.find((stream) => stream.codecType === "video");
    const audioStream = outputProbe.streams.find((stream) => stream.codecType === "audio");
    if (videoStream?.codecName !== "h264" || audioStream?.codecName !== "aac") {
      throw new Error("O arquivo final não contém os streams H.264/AAC esperados.");
    }
    if (!outputCadence.constantFrameRate || outputCadence.frameCount !== expectedFrames) {
      throw new Error(
        `A saída não atingiu ${fps} fps CFR: ${outputCadence.frameCount} quadros; esperado ${expectedFrames}; ` +
        `lacuna máxima ${outputCadence.maximumGapMs.toFixed(1)} ms.`,
      );
    }
    const manifest: ScreenManifest = {
      schemaVersion: 2,
      platform: "win32",
      createdAt: new Date().toISOString(),
      capture: { ...normalizedProject.capture, rawDurationSeconds: project.rawDurationSeconds },
      output: {
        videoPath, width, height, fps, cadence: outputCadence, durationSeconds: outputProbe.durationSeconds,
        videoCodec: "h264", audioCodec: "aac",
      },
      actions: project.actions,
      pointerPath: project.pointerPath,
      marks: project.marks,
      speed: speedMap,
      camera,
      cameraGenerated,
      cursor: {
        mode: cursorMode,
        size: options.cursor?.size ?? Math.max(24, Math.round(height * 0.036)),
        clickIndicator: options.cursor?.clickIndicator ?? true,
        clickColor: options.cursor?.clickColor ?? "#16B8F3CC",
        smoothing: options.cursor?.smoothing ?? 0,
      },
      captions,
      audio: preparedAudio.map((track) => track.manifest),
      warnings: [...project.warnings],
    };
    await writeFile(stagingManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await publishValidatedPair(stagingVideoPath, stagingManifestPath, videoPath, manifestPath, stagingToken);
    if (!keepIntermediates) {
      try { await cleanupScreenProject(project); }
      catch (error) {
        manifest.warnings.push(`Não foi possível remover intermediários: ${error instanceof Error ? error.message : String(error)}`);
        const replacementManifest = `${manifestPath}.auto-screen-${stagingToken}.json`;
        await writeFile(replacementManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        await rm(manifestPath, { force: true });
        await rename(replacementManifest, manifestPath);
      }
    }
    return { videoPath, manifestPath, manifest };
  } catch (error) {
    await Promise.all([
      rm(stagingVideoPath, { force: true }).catch(() => undefined),
      rm(stagingManifestPath, { force: true }).catch(() => undefined),
    ]);
    throw new Error(
      `Falha ao validar ou publicar o vídeo. Intermediários preservados em ${project.workDirectory}. ` +
      `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

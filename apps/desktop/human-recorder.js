import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { basename, join, resolve } from "node:path";
import { copyFile, rename, rm, writeFile } from "node:fs/promises";
import { WebcamRecorderSession } from "./webcam.js";
import { MicrophoneRecorderSession } from "./microphone.js";
import {
  cleanupScreenProject,
  createScreenRecorder,
  probeMedia,
  probeVideoCadence,
} from "./runtime/index.js";

const DEFAULT_MAX_DURATION_SECONDS = 3_600;

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function runProcess(executable, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", rejectPromise);
    child.once("close", (code) => {
      if ((code ?? -1) !== 0) {
        rejectPromise(new Error(`${executable} terminou com código ${code ?? -1}: ${stderr.trim()}`));
        return;
      }
      resolvePromise();
    });
  });
}

function encodedSize(project) {
  return project.capture.encodedSize ?? {
    width: project.capture.bounds.width,
    height: project.capture.bounds.height,
  };
}

function assertCompatible(projects) {
  const reference = projects[0];
  if (!reference) throw new Error("Nenhum segmento foi gravado.");
  const expectedSize = encodedSize(reference);
  for (const project of projects.slice(1)) {
    const size = encodedSize(project);
    if (
      project.capture.backend !== reference.capture.backend ||
      project.capture.requestedFps !== reference.capture.requestedFps ||
      project.capture.display.index !== reference.capture.display.index ||
      size.width !== expectedSize.width ||
      size.height !== expectedSize.height
    ) {
      throw new Error("Os segmentos não possuem a mesma fonte, resolução e taxa de quadros.");
    }
    if (Boolean(project.webcam) !== Boolean(reference.webcam)) {
      throw new Error("Os segmentos não possuem a mesma configuração de webcam.");
    }
    if (Boolean(project.microphone) !== Boolean(reference.microphone)) {
      throw new Error("Os segmentos não possuem a mesma configuração de microfone.");
    }
  }
}

function shiftedTimeline(projects) {
  const actions = [];
  const pointerPath = [];
  const marks = [];
  let offset = 0;
  for (const project of projects) {
    actions.push(...project.actions.map((action) => ({
      ...action,
      requestedAtSeconds: action.requestedAtSeconds + offset,
      actualAtSeconds: action.actualAtSeconds + offset,
    })));
    pointerPath.push(...project.pointerPath.map((sample) => ({
      ...sample,
      timeSeconds: sample.timeSeconds + offset,
    })));
    marks.push(...project.marks.map((mark) => ({
      ...mark,
      timeSeconds: mark.timeSeconds + offset,
    })));
    offset += project.rawDurationSeconds;
  }
  return { actions, pointerPath, marks };
}

async function consolidateProjects(projects, ffmpegPath) {
  if (projects.length === 1) return projects[0];
  assertCompatible(projects);

  const base = projects[0];
  const workDirectory = resolve(base.workDirectory);
  const rawVideoPath = join(workDirectory, "capture-consolidated.mkv");
  const segmentPaths = [];

  for (const [index, project] of projects.entries()) {
    const destination = join(workDirectory, `capture-segment-${String(index + 1).padStart(4, "0")}.mkv`);
    await rm(destination, { force: true });
    await copyFile(resolve(project.rawVideoPath), destination);
    segmentPaths.push(destination);
  }

  const concatPath = join(workDirectory, "segments.ffconcat");
  const concatDocument = [
    "ffconcat version 1.0",
    ...segmentPaths.map((path) => `file '${basename(path)}'`),
    "",
  ].join("\n");
  await writeFile(concatPath, concatDocument, "utf8");
  await rm(rawVideoPath, { force: true });

  const copyArguments = [
    "-y", "-hide_banner", "-loglevel", "warning",
    "-f", "concat", "-safe", "0", "-i", basename(concatPath),
    "-map", "0:v:0", "-an", "-c:v", "copy", basename(rawVideoPath),
  ];

  let copied = true;
  try {
    await runProcess(ffmpegPath, copyArguments, workDirectory);
  } catch {
    copied = false;
    await rm(rawVideoPath, { force: true });
    await runProcess(ffmpegPath, [
      "-y", "-hide_banner", "-loglevel", "warning",
      "-f", "concat", "-safe", "0", "-i", basename(concatPath),
      "-map", "0:v:0", "-an",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "12",
      "-pix_fmt", "yuv420p", "-fps_mode", "cfr", basename(rawVideoPath),
    ], workDirectory);
  }

  const probe = await probeMedia(rawVideoPath, ffmpegPath);
  const cadence = await probeVideoCadence(rawVideoPath, base.capture.requestedFps, ffmpegPath);
  const video = probe.streams.find((stream) => stream.codecType === "video");
  if (!video?.width || !video.height || probe.durationSeconds <= 0) {
    throw new Error("O vídeo consolidado não possui um stream de vídeo válido.");
  }

  const timeline = shiftedTimeline(projects);
  const webcamSegments = [];
  const microphoneSegments = [];
  if (base.webcam) {
    if (projects.some((project) => !project.webcam || project.webcam.segments.length !== 1)) {
      throw new Error("Um segmento da webcam está ausente.");
    }
    for (const [index, project] of projects.entries()) {
      const segment = project.webcam.segments[0];
      const destination = join(workDirectory, `webcam-segment-${String(index + 1).padStart(4, "0")}.mkv`);
      await copyFile(resolve(segment.path), destination);
      webcamSegments.push({ ...segment, path: destination });
    }
  }
  if (base.microphone) {
    if (projects.some((project) => !project.microphone || project.microphone.segments.length !== 1)) {
      throw new Error("Um segmento do microfone está ausente.");
    }
    for (const [index, project] of projects.entries()) {
      const segment = project.microphone.segments[0];
      const destination = join(workDirectory, `microphone-segment-${String(index + 1).padStart(4, "0")}.wav`);
      await copyFile(resolve(segment.path), destination);
      microphoneSegments.push({ ...segment, path: destination });
    }
  }
  const warnings = projects.flatMap((project) => project.warnings);
  warnings.push(
    copied
      ? `${projects.length} segmentos foram consolidados sem recodificação.`
      : `${projects.length} segmentos foram consolidados com recodificação H.264 de compatibilidade.`,
  );

  await Promise.all([
    rm(concatPath, { force: true }),
    ...segmentPaths.map((path) => rm(path, { force: true })),
  ]);

  return {
    ...base,
    rawVideoPath,
    rawDurationSeconds: probe.durationSeconds,
    ...(base.webcam ? { webcam: { layout: base.webcam.layout, segments: webcamSegments } } : {}),
    ...(base.microphone ? { microphone: { segments: microphoneSegments } } : {}),
    capture: {
      ...base.capture,
      encodedSize: { width: video.width, height: video.height },
      cadence,
    },
    actions: timeline.actions,
    pointerPath: timeline.pointerPath,
    marks: timeline.marks,
    warnings,
  };
}

async function assembleMicrophone(project, ffmpegPath) {
  if (!project.microphone) return project;
  const segments = project.microphone.segments;
  const output = join(project.workDirectory, "microphone-raw.wav");
  const graph = segments.map((segment, index) => {
    const trimStart = Math.max(0, segment.startOffsetSeconds);
    const delayMs = Math.round(Math.max(0, -segment.startOffsetSeconds) * 1_000);
    return `[${index}:a]atrim=start=${trimStart},asetpts=PTS-STARTPTS,aresample=48000,` +
      `${delayMs > 0 ? `adelay=${delayMs},` : ""}apad,atrim=duration=${segment.durationSeconds},asetpts=PTS-STARTPTS[mic${index}]`;
  });
  graph.push(`${segments.map((_, index) => `[mic${index}]`).join("")}concat=n=${segments.length}:v=0:a=1,` +
    `apad,atrim=duration=${project.rawDurationSeconds}[micout]`);
  await runProcess(ffmpegPath, [
    "-y", "-hide_banner", "-loglevel", "warning",
    ...segments.flatMap((segment) => ["-i", segment.path]),
    "-filter_complex", graph.join(";"), "-map", "[micout]",
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", output,
  ], project.workDirectory);
  const probe = await probeMedia(output, ffmpegPath);
  if (!probe.streams.some((stream) => stream.codecType === "audio") || probe.durationSeconds <= 0) {
    throw new Error("A faixa consolidada do microfone está vazia.");
  }
  project.microphone.path = output;
  return project;
}

export class HumanRecorderSession {
  constructor(config, dependencies = {}) {
    const { webcam, microphone, ...recorderConfig } = config;
    this.config = {
      ...recorderConfig,
      capture: config.capture,
      maxDurationSeconds: config.maxDurationSeconds ?? DEFAULT_MAX_DURATION_SECONDS,
    };
    this.webcamConfig = webcam?.enabled ? webcam : undefined;
    this.microphoneConfig = microphone?.enabled ? microphone : undefined;
    this.createRecorder = dependencies.createRecorder ?? createScreenRecorder;
    this.createWebcam = dependencies.createWebcam ?? ((options) => new WebcamRecorderSession(options));
    this.createMicrophone = dependencies.createMicrophone ?? ((options) => new MicrophoneRecorderSession(options));
    this.consolidate = dependencies.consolidateProjects ?? consolidateProjects;
    this.ffmpegPath = config.ffmpegPath ?? process.env.AUTO_SCREEN_FFMPEG_PATH ?? "ffmpeg";
    this.currentRecorder = undefined;
    this.currentWebcam = undefined;
    this.currentMicrophone = undefined;
    this.currentStartedAt = 0;
    this.completedSeconds = 0;
    this.segmentProjects = [];
    this.finalProject = undefined;
    this.currentProject = undefined;
    this._state = "idle";
    this._segmentCount = 0;
    this.limitReached = false;
  }

  get state() { return this._state; }
  get durationLimitReached() { return this.limitReached || this.currentRecorder?.durationLimitReached === true; }
  get canRetryStop() { return Boolean(this.finalProject || (!this.currentRecorder && this.segmentProjects.length)); }
  get recoveryDirectories() {
    return [...new Set([
      this.finalProject?.workDirectory,
      this.currentProject?.workDirectory,
      ...this.segmentProjects.map((project) => project.workDirectory),
      this.currentRecorder?.recoveryDirectory,
      this.currentWebcam?.workDirectory,
      this.currentMicrophone?.directory,
    ].filter(Boolean))];
  }
  get previewFrame() { return this.currentWebcam?.previewFrame ?? null; }
  get segmentCount() { return this._segmentCount || this.segmentProjects.length; }
  get elapsedSeconds() {
    if (["recording", "pausing", "stopping"].includes(this._state) && this.currentStartedAt > 0) {
      const end = this.currentRecorder?.timelineStopMilliseconds || performance.now();
      return this.completedSeconds + Math.max(0, (end - this.currentStartedAt) / 1_000);
    }
    return this.completedSeconds;
  }

  assertState(expected) {
    if (!expected.includes(this._state)) {
      throw new Error(`A gravação não pode executar esta ação no estado "${this._state}".`);
    }
  }

  remainingDuration() {
    const limit = this.config.maxDurationSeconds ?? DEFAULT_MAX_DURATION_SECONDS;
    const remaining = limit - this.completedSeconds;
    if (remaining <= 0) throw new Error("A gravação atingiu a duração máxima configurada.");
    return remaining;
  }

  async openSegment() {
    if (this.webcamConfig) {
      this.currentWebcam = this.createWebcam({
        deviceId: this.webcamConfig.deviceId,
        ...(this.microphoneConfig ? { microphoneDeviceId: this.microphoneConfig.deviceId } : {}),
        ffmpegPath: this.ffmpegPath,
      });
      await this.currentWebcam.start();
    }
    if (this.microphoneConfig && !this.webcamConfig) {
      this.currentMicrophone = this.createMicrophone({ deviceId: this.microphoneConfig.deviceId, ffmpegPath: this.ffmpegPath });
      await this.currentMicrophone.start();
    }
    const recorder = this.createRecorder({
      ...this.config,
      maxDurationSeconds: this.remainingDuration(),
      durationLimitAction: "stop",
    });
    this.currentRecorder = recorder;
    this.currentProject = undefined;
    await recorder.start();
    this.currentStartedAt = performance.now();
  }

  async closeSegment() {
    const recorder = this.currentRecorder;
    if (!recorder) throw new Error("Não há segmento ativo para encerrar.");
    const webcam = this.currentWebcam;
    const microphone = this.currentMicrophone;
    // A captura de áudio continua até o encerramento da tela para não perder os últimos quadros.
    const [screenResult] = await Promise.allSettled([Promise.resolve().then(() => recorder.stop())]);
    this.limitReached ||= recorder.durationLimitReached === true;
    if (screenResult.status === "fulfilled") this.currentProject = screenResult.value;
    const [webcamResult, microphoneResult] = await Promise.allSettled([
      webcam ? webcam.stop() : Promise.resolve(undefined),
      microphone ? microphone.stop() : Promise.resolve(undefined),
    ]);
    if (screenResult.status === "rejected" || webcamResult.status === "rejected" || microphoneResult.status === "rejected") {
      throw screenResult.status === "rejected" ? screenResult.reason : webcamResult.status === "rejected" ? webcamResult.reason : microphoneResult.reason;
    }
    const project = screenResult.value;
    const screenEndMs = Number.isFinite(recorder.timelineStopMilliseconds) && recorder.timelineStopMilliseconds > 0
      ? recorder.timelineStopMilliseconds
      : recorder.timelineEpochMilliseconds + project.rawDurationSeconds * 1_000;
    const screenStartMs = screenEndMs - project.rawDurationSeconds * 1_000;
    const offsetFor = (media) => Number.isFinite(media.endMs)
      ? (screenStartMs - (media.endMs - media.durationSeconds * 1_000)) / 1_000
      : (recorder.timelineEpochMilliseconds - media.epochMs) / 1_000;
    if (webcam && webcamResult.value) {
      const startOffsetSeconds = offsetFor(webcamResult.value);
      const missingCameraSeconds = project.rawDurationSeconds + startOffsetSeconds - webcamResult.value.durationSeconds;
      if (missingCameraSeconds > 1) {
        throw new Error("A webcam parou antes da tela. Verifique a conexão da câmera e grave novamente.");
      }
      const destination = join(project.workDirectory, "webcam.mkv");
      await rename(webcamResult.value.path, destination);
      project.webcam = {
        layout: {
          size: this.webcamConfig.size,
          shape: this.webcamConfig.shape,
          border: this.webcamConfig.border,
          borderColor: this.webcamConfig.borderColor,
          position: this.webcamConfig.position,
          backgroundBlur: this.webcamConfig.backgroundBlur ?? 0,
          faceRetouch: this.webcamConfig.faceRetouch ?? 0,
        },
        segments: [{
          path: destination,
          startOffsetSeconds,
          durationSeconds: project.rawDurationSeconds,
        }],
      };
    }
    const microphoneMedia = webcam && this.microphoneConfig
      ? webcamResult.value?.microphone
      : microphoneResult.value;
    if (this.microphoneConfig && !microphoneMedia) {
      throw new Error("A captura conjunta não gerou áudio do microfone.");
    }
    if (microphoneMedia) {
      const latencyMs = this.microphoneConfig?.latencyMs ?? 0;
      if (!Number.isInteger(latencyMs) || latencyMs < 0 || latencyMs > 1_000 || latencyMs % 25 !== 0) {
        throw new RangeError("A compensação de latência do microfone é inválida.");
      }
      const startOffsetSeconds = offsetFor(microphoneMedia) + latencyMs / 1_000;
      const missingSeconds = project.rawDurationSeconds + startOffsetSeconds - microphoneMedia.durationSeconds;
      if (missingSeconds > 0.5) {
        project.warnings.push(`Microfone: os últimos ${missingSeconds.toFixed(1)} s deste trecho não contêm áudio; o vídeo foi preservado.`);
      }
      const destination = join(project.workDirectory, "microphone.wav");
      await rename(microphoneMedia.path, destination);
      project.microphone = {
        segments: [{
          path: destination,
          startOffsetSeconds,
          durationSeconds: project.rawDurationSeconds,
        }],
      };
    }
    for (const media of [webcam, microphone]) {
      try { await media?.cleanup(); }
      catch (error) { project.warnings.push(`Não foi possível remover uma pasta de mídia: ${messageOf(error)}`); }
    }
    this.currentRecorder = undefined;
    this.currentProject = undefined;
    this.currentWebcam = undefined;
    this.currentMicrophone = undefined;
    this.currentStartedAt = 0;
    this.segmentProjects.push(project);
    this.completedSeconds = this.segmentProjects.reduce((total, item) => total + item.rawDurationSeconds, 0);
    return project;
  }

  async start() {
    this.assertState(["idle"]);
    this._state = "starting";
    try {
      await this.openSegment();
      this._state = "recording";
      return this;
    } catch (error) {
      this._state = "failed";
      throw error;
    }
  }

  async pause() {
    this.assertState(["recording"]);
    this._state = "pausing";
    try {
      await this.closeSegment();
      this._state = "paused";
      return this;
    } catch (error) {
      this._state = "failed";
      throw error;
    }
  }

  async resume() {
    this.assertState(["paused"]);
    this._state = "resuming";
    try {
      await this.openSegment();
      this._state = "recording";
      return this;
    } catch (error) {
      this._state = "failed";
      throw error;
    }
  }

  async stop() {
    this.assertState(["recording", "paused", "failed"]);
    if (this._state === "failed" && !this.canRetryStop) throw new Error("Os arquivos foram preservados, mas este trecho exige recuperação manual.");
    const wasRecording = this._state === "recording";
    this._state = "stopping";
    try {
      if (wasRecording) await this.closeSegment();
      if (this.segmentProjects.length === 0) throw new Error("Nenhum segmento válido foi gravado.");
      this._segmentCount = this.segmentProjects.length;
      this.finalProject ??= await this.consolidate(this.segmentProjects, this.ffmpegPath);
      this.finalProject = await assembleMicrophone(this.finalProject, this.ffmpegPath);
      for (const project of this.segmentProjects) {
        if (project.workDirectory === this.finalProject.workDirectory) continue;
        try { await cleanupScreenProject(project); }
        catch (error) { this.finalProject.warnings.push(`Não foi possível remover um diretório de segmento: ${messageOf(error)}`); }
      }
      this.completedSeconds = this.finalProject.rawDurationSeconds;
      this._state = "stopped";
      return this.finalProject;
    } catch (error) {
      this._state = "failed";
      throw error;
    }
  }

  // Falhas e encerramento param os dispositivos sem autorizar a exclusão da mídia capturada.
  async preserve() {
    this._state = "failed";
    await Promise.allSettled([
      this.currentRecorder?.stop(),
      this.currentWebcam?.stop(),
      this.currentMicrophone?.stop(),
    ]);
    return this.recoveryDirectories;
  }

  async cleanup() {
    if (this.currentWebcam) {
      try { await this.currentWebcam.cleanup(); } catch { /* melhor esforço */ }
      this.currentWebcam = undefined;
    }
    if (this.currentMicrophone) {
      try { await this.currentMicrophone.cleanup(); } catch { /* melhor esforço */ }
      this.currentMicrophone = undefined;
    }
    const projects = [...this.segmentProjects];
    if (this.currentProject) projects.push(this.currentProject);
    if (this.finalProject) {
      projects.push(this.finalProject);
    } else {
      if (this.currentRecorder) {
        try {
          projects.push(await this.currentRecorder.stop());
        } catch {
          // Uma captura que falhou é preservada pelo motor para diagnóstico.
        }
        this.currentRecorder = undefined;
      }
    }

    const seen = new Set();
    for (const project of projects) {
      if (!project || seen.has(project.workDirectory)) continue;
      seen.add(project.workDirectory);
      try { await cleanupScreenProject(project); } catch { /* melhor esforço */ }
    }
    this._state = "stopped";
  }
}

import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { basename, join, resolve } from "node:path";
import { rename, rm, writeFile } from "node:fs/promises";
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
  const rawVideoPath = join(workDirectory, "capture.mkv");
  const segmentPaths = [];

  for (const [index, project] of projects.entries()) {
    const destination = join(workDirectory, `capture-segment-${String(index + 1).padStart(4, "0")}.mkv`);
    await rm(destination, { force: true });
    await rename(resolve(project.rawVideoPath), destination);
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
  const warnings = projects.flatMap((project) => project.warnings);
  warnings.push(
    copied
      ? `${projects.length} segmentos foram consolidados sem recodificação.`
      : `${projects.length} segmentos foram consolidados com recodificação H.264 de compatibilidade.`,
  );

  for (const project of projects.slice(1)) {
    try {
      await cleanupScreenProject(project);
    } catch (error) {
      warnings.push(`Não foi possível remover um diretório de segmento: ${messageOf(error)}`);
    }
  }

  await Promise.all([
    rm(concatPath, { force: true }),
    ...segmentPaths.map((path) => rm(path, { force: true })),
  ]);

  return {
    ...base,
    rawVideoPath,
    rawDurationSeconds: probe.durationSeconds,
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

export class HumanRecorderSession {
  constructor(config, dependencies = {}) {
    this.config = {
      ...config,
      capture: config.capture,
      maxDurationSeconds: config.maxDurationSeconds ?? DEFAULT_MAX_DURATION_SECONDS,
    };
    this.createRecorder = dependencies.createRecorder ?? createScreenRecorder;
    this.consolidate = dependencies.consolidateProjects ?? consolidateProjects;
    this.ffmpegPath = config.ffmpegPath ?? process.env.AUTO_SCREEN_FFMPEG_PATH ?? "ffmpeg";
    this.currentRecorder = undefined;
    this.currentStartedAt = 0;
    this.completedSeconds = 0;
    this.segmentProjects = [];
    this.finalProject = undefined;
    this._state = "idle";
    this._segmentCount = 0;
  }

  get state() { return this._state; }
  get segmentCount() { return this._segmentCount || this.segmentProjects.length; }
  get elapsedSeconds() {
    if (["recording", "pausing", "stopping"].includes(this._state) && this.currentStartedAt > 0) {
      return this.completedSeconds + Math.max(0, (performance.now() - this.currentStartedAt) / 1_000);
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
    const recorder = this.createRecorder({
      ...this.config,
      maxDurationSeconds: this.remainingDuration(),
    });
    this.currentRecorder = recorder;
    await recorder.start();
    this.currentStartedAt = performance.now();
  }

  async closeSegment() {
    const recorder = this.currentRecorder;
    if (!recorder) throw new Error("Não há segmento ativo para encerrar.");
    const project = await recorder.stop();
    this.currentRecorder = undefined;
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
    this.assertState(["recording", "paused"]);
    const wasRecording = this._state === "recording";
    this._state = "stopping";
    try {
      if (wasRecording) await this.closeSegment();
      if (this.segmentProjects.length === 0) throw new Error("Nenhum segmento válido foi gravado.");
      this._segmentCount = this.segmentProjects.length;
      this.finalProject = await this.consolidate(this.segmentProjects, this.ffmpegPath);
      this.completedSeconds = this.finalProject.rawDurationSeconds;
      this._state = "stopped";
      return this.finalProject;
    } catch (error) {
      this._state = "failed";
      throw error;
    }
  }

  async cleanup() {
    const projects = [];
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
      projects.push(...this.segmentProjects);
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

import { extname, join } from "node:path";
import {
  cleanupScreenProject,
  listDisplays,
  listWindows,
  renderScreenProject,
  runDoctor,
} from "./runtime/index.js";
import { HumanRecorderSession } from "./human-recorder.js";
import { listWebcams } from "./webcam.js";
import { listMicrophones } from "./microphone.js";
import { enhanceVoiceLocal, fitGeneratedVoice, makeApiAudio, makeVoiceReference } from "./voice.js";
import { applyWebcamEffects, prepareWebcamEffects } from "./webcam-effects.js";

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

class RecorderWorker {
  constructor() {
    this.session = undefined;
    this.project = undefined;
    this.segmentCount = 0;
    this.previewPath = undefined;
    this.previewing = false;
    this.rendering = false;
    this.semanticSource = undefined;
    this.windowMetadata = undefined;
    this.quality = "balanced";
    this.voicePath = undefined;
    this.voiceMode = "original";
    this.voiceSyncMs = 0;
    this.voiceRevision = 0;
    this.webcamEffectsPending = false;
    this.webcamRawPaths = [];
  }

  status() {
    const project = this.project;
    return {
      phase: this.rendering
        ? "rendering"
        : this.previewing
          ? "previewing"
          : this.session
            ? this.session.state
            : project
              ? "captured"
              : "idle",
      elapsedSeconds: this.session?.elapsedSeconds ?? project?.rawDurationSeconds ?? 0,
      previewFrame: this.session?.previewFrame ?? null,
      segmentCount: this.session?.segmentCount ?? this.segmentCount,
      previewPath: this.previewPath ?? null,
      previewRevision: this.voiceRevision,
      hasMicrophone: Boolean(project?.microphone?.path),
      hasWebcam: Boolean(project?.webcam),
      webcamFilters: project?.webcam ? {
        backgroundBlur: project.webcam.layout.backgroundBlur ?? 0,
        faceRetouch: project.webcam.layout.faceRetouch ?? 0,
      } : null,
      audioWarnings: project?.warnings.filter((warning) => warning.startsWith("Microfone:")) ?? [],
      voiceMode: this.voiceMode,
      voiceSyncMs: this.voiceSyncMs,
      effectsPending: this.webcamEffectsPending,
      project: project ? {
        durationSeconds: project.rawDurationSeconds,
        width: project.capture.encodedSize?.width ?? project.capture.bounds.width,
        height: project.capture.encodedSize?.height ?? project.capture.bounds.height,
        segmentCount: this.segmentCount || 1,
      } : null,
    };
  }

  async start(payload) {
    if (this.session) throw new Error("Já existe uma gravação em andamento.");
    if (this.project) throw new Error("Salve ou descarte a gravação atual antes de iniciar outra.");
    const options = payload && typeof payload === "object" ? payload : {};
    if (!options.capture) throw new TypeError("A fonte de captura não foi informada.");

    const cursorMode = ["software", "native", "hidden"].includes(options.cursorMode)
      ? options.cursorMode
      : options.showCursor === false
        ? "hidden"
        : "native";
    this.semanticSource = options.semanticSource;
    this.windowMetadata = options.windowMetadata;
    this.segmentCount = 0;
    this.quality = ["high", "balanced", "compact"].includes(options.quality) ? options.quality : "balanced";
    this.previewPath = undefined;
    this.voicePath = undefined;
    this.voiceMode = "original";
    this.voiceSyncMs = 0;
    this.voiceRevision = 0;
    this.webcamEffectsPending = false;
    this.webcamRawPaths = [];
    this.session = new HumanRecorderSession({
      capture: options.capture,
      captureBackend: "dda",
      fps: options.fps === 30 ? 30 : 60,
      cursorMode,
      observePointerButtons: cursorMode === "software",
      maxDurationSeconds: 3_600,
      webcam: options.webcam,
      microphone: options.microphone,
    });
    try {
      await this.session.start();
      return this.status();
    } catch (error) {
      const failedSession = this.session;
      this.session = undefined;
      this.semanticSource = undefined;
      this.windowMetadata = undefined;
      try { await failedSession?.cleanup(); } catch { /* melhor esforço */ }
      throw error;
    }
  }

  async pauseOrResume() {
    if (!this.session) throw new Error("Não há gravação em andamento.");
    if (this.session.state === "recording") await this.session.pause();
    else if (this.session.state === "paused") await this.session.resume();
    else throw new Error(`A gravação não pode alternar pausa no estado ${this.session.state}.`);
    return this.status();
  }

  async stop() {
    if (!this.session) throw new Error("Não há gravação em andamento.");
    const session = this.session;
    try {
      const project = await session.stop();
      if (this.semanticSource) project.capture.source = this.semanticSource;
      if (this.windowMetadata) project.capture.window = this.windowMetadata;
      this.project = project;
      this.webcamEffectsPending = Boolean(project.webcam && (project.webcam.layout.backgroundBlur || project.webcam.layout.faceRetouch));
      this.webcamRawPaths = project.webcam?.segments.map((segment) => segment.path) ?? [];
      this.voicePath = project.microphone?.path;
      this.segmentCount = session.segmentCount;
      this.session = undefined;
      this.semanticSource = undefined;
      this.windowMetadata = undefined;
      return this.status();
    } catch (error) {
      try { await session.cleanup(); } catch { /* preservar erro original */ }
      this.session = undefined;
      this.semanticSource = undefined;
      this.windowMetadata = undefined;
      throw error;
    }
  }

  renderOptions(project, outPrefix, keepIntermediates) {
    if (this.webcamEffectsPending) throw new Error("Aplique os filtros da webcam antes de salvar ou visualizar o vídeo.");
    return {
      outPrefix,
      width: project.capture.encodedSize?.width ?? project.capture.bounds.width,
      height: project.capture.encodedSize?.height ?? project.capture.bounds.height,
      fps: project.capture.requestedFps,
      quality: this.quality,
      camera: [],
      cursor: {
        clickIndicator: false,
        smoothing: project.capture.cursorMode === "software" ? 0.72 : 0,
      },
      ...(this.voicePath ? { audio: [{
        id: `microphone-${this.voiceMode}`,
        source: { kind: "file", path: this.voicePath },
        startSeconds: Math.max(0, this.voiceSyncMs / 1_000),
        trimStartSeconds: Math.max(0, -this.voiceSyncMs / 1_000),
      }] } : {}),
      keepIntermediates,
    };
  }

  async preview() {
    if (!this.project) throw new Error("Não há gravação pronta para visualizar.");
    if (this.rendering || this.previewing) throw new Error("A gravação já está sendo processada.");
    if (this.previewPath) return this.status();
    const project = this.project;
    this.previewing = true;
    try {
      const rendered = await renderScreenProject(
        project,
        this.renderOptions(project, join(project.workDirectory, "preview", `auto-screen-preview-${this.voiceRevision}`), true),
      );
      this.previewPath = rendered.videoPath;
      this.previewing = false;
      return this.status();
    } catch (error) {
      this.previewing = false;
      throw error;
    }
  }

  async save(payload) {
    if (!this.project) throw new Error("Não há gravação pronta para salvar.");
    if (this.rendering || this.previewing) throw new Error("A gravação já está sendo processada.");
    const requested = String(payload?.outputFile ?? "");
    if (!requested) throw new TypeError("O caminho de saída não foi informado.");
    const outputFile = extname(requested).toLocaleLowerCase() === ".mp4" ? requested : `${requested}.mp4`;
    const project = this.project;
    this.rendering = true;
    try {
      const rendered = await renderScreenProject(
        project,
        this.renderOptions(project, outputFile.slice(0, -4), false),
      );
      this.project = undefined;
      this.segmentCount = 0;
      this.previewPath = undefined;
      this.voicePath = undefined;
      this.voiceMode = "original";
      this.voiceSyncMs = 0;
      this.webcamEffectsPending = false;
      this.webcamRawPaths = [];
      this.rendering = false;
      return { status: this.status(), videoPath: rendered.videoPath, manifestPath: rendered.manifestPath };
    } catch (error) {
      this.rendering = false;
      throw error;
    }
  }

  async discard() {
    if (this.project) await cleanupScreenProject(this.project);
    this.project = undefined;
    this.segmentCount = 0;
    this.previewPath = undefined;
    this.voicePath = undefined;
    this.voiceMode = "original";
    this.voiceSyncMs = 0;
    this.webcamEffectsPending = false;
    this.webcamRawPaths = [];
    return this.status();
  }

  async cleanup() {
    if (this.session) {
      const session = this.session;
      try {
        if (["recording", "paused"].includes(session.state)) {
          await cleanupScreenProject(await session.stop());
        } else {
          await session.cleanup();
        }
      } catch {
        await session.cleanup();
      }
    }
    this.session = undefined;
    if (this.project) {
      try { await cleanupScreenProject(this.project); } catch { /* melhor esforço */ }
    }
    this.project = undefined;
    this.segmentCount = 0;
    this.previewPath = undefined;
    this.voicePath = undefined;
    this.voiceMode = "original";
    this.voiceSyncMs = 0;
    this.webcamEffectsPending = false;
    this.webcamRawPaths = [];
    this.previewing = false;
    this.semanticSource = undefined;
    this.windowMetadata = undefined;
    return this.status();
  }

  async handle(command, payload) {
    switch (command) {
      case "status": return this.status();
      case "doctor": return await runDoctor();
      case "displays": return await listDisplays();
      case "windows": return await listWindows();
      case "webcams": return await listWebcams();
      case "microphones": return await listMicrophones();
      case "webcam-effects-sources": {
        if (!this.project) throw new Error("Não há gravação pronta para filtrar.");
        if (!this.webcamEffectsPending) return [];
        return await prepareWebcamEffects(this.project);
      }
      case "webcam-effects-configure": {
        if (!this.project?.webcam) throw new Error("Esta gravação não contém webcam.");
        const backgroundBlur = Number(payload?.backgroundBlur);
        const faceRetouch = Number(payload?.faceRetouch);
        if (![backgroundBlur, faceRetouch].every((value) => Number.isInteger(value) && value >= 0 && value <= 100)) {
          throw new TypeError("Escolha intensidades de filtro entre 0 e 100%.");
        }
        if (this.webcamRawPaths.length !== this.project.webcam.segments.length) {
          throw new Error("Os segmentos originais da webcam não estão disponíveis.");
        }
        this.project.webcam.layout.backgroundBlur = backgroundBlur;
        this.project.webcam.layout.faceRetouch = faceRetouch;
        this.project.webcam.segments.forEach((segment, index) => { segment.path = this.webcamRawPaths[index]; });
        this.webcamEffectsPending = backgroundBlur > 0 || faceRetouch > 0;
        this.voiceRevision += 1;
        this.previewPath = undefined;
        return this.status();
      }
      case "webcam-effects-apply": {
        if (!this.project) throw new Error("Não há gravação pronta para filtrar.");
        await applyWebcamEffects(this.project, payload?.paths);
        this.webcamEffectsPending = false;
        return this.status();
      }
      case "voice-info": {
        if (!this.project?.microphone?.path) throw new Error("Esta gravação não contém voz do microfone.");
        return { path: this.project.microphone.path, durationSeconds: this.project.rawDurationSeconds };
      }
      case "voice-api-audio": {
        if (!this.project?.microphone?.path) throw new Error("Esta gravação não contém voz do microfone.");
        const output = join(this.project.workDirectory, "voice-api-input.mp3");
        return await makeApiAudio(this.project.microphone.path, output);
      }
      case "voice-reference-audio": {
        if (!this.project?.microphone?.path) throw new Error("Esta gravação não contém voz do microfone.");
        const output = join(this.project.workDirectory, "voice-reference-recorded.mp3");
        const source = this.voiceMode === "local" ? this.voicePath : this.project.microphone.path;
        return await makeVoiceReference(source, output);
      }
      case "voice-local": {
        if (!this.project?.microphone?.path) throw new Error("Esta gravação não contém voz do microfone.");
        const output = join(this.project.workDirectory, "voice-local.wav");
        await enhanceVoiceLocal(this.project.microphone.path, output, Number(payload?.strength ?? 0.7), payload?.method ?? "rnnoise");
        this.voicePath = output;
        this.voiceMode = "local";
        this.voiceRevision += 1;
        this.previewPath = undefined;
        return this.status();
      }
      case "voice-replace": {
        if (!this.project?.microphone?.path) throw new Error("Esta gravação não contém voz do microfone.");
        const source = String(payload?.path ?? "");
        if (!source || source !== join(this.project.workDirectory, "voice-generated.mp3")) {
          throw new Error("O arquivo de voz gerada não pertence à gravação atual.");
        }
        const output = join(this.project.workDirectory, "voice-generated-fitted.wav");
        const result = await fitGeneratedVoice(source, output, this.project.rawDurationSeconds);
        this.voicePath = output;
        this.voiceMode = "openrouter";
        this.voiceRevision += 1;
        this.previewPath = undefined;
        return { status: this.status(), speedRatio: result.speedRatio };
      }
      case "voice-original": {
        if (!this.project?.microphone?.path) throw new Error("Esta gravação não contém voz do microfone.");
        this.voicePath = this.project.microphone.path;
        this.voiceMode = "original";
        this.voiceRevision += 1;
        this.previewPath = undefined;
        return this.status();
      }
      case "voice-sync": {
        if (!this.project?.microphone?.path) throw new Error("Esta gravação não contém voz do microfone.");
        const milliseconds = Number(payload?.milliseconds);
        if (!Number.isInteger(milliseconds) || Math.abs(milliseconds) > 1_500 || milliseconds % 50 !== 0) {
          throw new RangeError("Ajuste a voz em passos de 50 ms, entre -1500 e +1500 ms.");
        }
        if (Math.abs(milliseconds) / 1_000 >= this.project.rawDurationSeconds) {
          throw new RangeError("O ajuste da voz excede a duração da gravação.");
        }
        if (milliseconds !== this.voiceSyncMs) {
          this.voiceSyncMs = milliseconds;
          this.voiceRevision += 1;
          this.previewPath = undefined;
        }
        return this.status();
      }
      case "start": return await this.start(payload);
      case "pause-resume": return await this.pauseOrResume();
      case "stop": return await this.stop();
      case "preview": return await this.preview();
      case "save": return await this.save(payload);
      case "discard": return await this.discard();
      case "cleanup": return await this.cleanup();
      default: throw new Error(`Comando desconhecido do worker: ${command}`);
    }
  }
}

const PROTOCOL_PREFIX = "@@AUTO_SCREEN@@";
const worker = new RecorderWorker();
let buffer = "";
let queue = Promise.resolve();

function respond(message) {
  if (process.parentPort) process.parentPort.postMessage(message);
  else process.stdout.write(`${PROTOCOL_PREFIX}${JSON.stringify(message)}\n`);
}

async function dispatch(message) {
  const id = message?.id;
  try {
    const value = await worker.handle(message?.command, message?.payload);
    respond({ id, ok: true, value });
  } catch (error) {
    respond({ id, ok: false, error: messageOf(error) });
  }
}

if (process.parentPort) {
  process.parentPort.on("message", (event) => {
    queue = queue.then(() => dispatch(event.data), () => dispatch(event.data));
  });
} else {
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        respond({ id: null, ok: false, error: `Mensagem JSON inválida: ${messageOf(error)}` });
        continue;
      }
      queue = queue.then(() => dispatch(message), () => dispatch(message));
    }
  });

  process.stdin.on("end", () => {
    queue = queue.finally(async () => {
      await worker.cleanup();
      process.exit(0);
    });
  });
}

process.on("SIGTERM", () => {
  void worker.cleanup().finally(() => process.exit(0));
});

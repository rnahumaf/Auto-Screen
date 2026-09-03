import { extname } from "node:path";
import {
  cleanupScreenProject,
  listDisplays,
  listWindows,
  renderScreenProject,
  runDoctor,
} from "../../dist/index.js";
import { HumanRecorderSession } from "./human-recorder.js";

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

class RecorderWorker {
  constructor() {
    this.session = undefined;
    this.project = undefined;
    this.segmentCount = 0;
    this.rendering = false;
    this.semanticSource = undefined;
    this.windowMetadata = undefined;
  }

  status() {
    const project = this.project;
    return {
      phase: this.rendering
        ? "rendering"
        : this.session
          ? this.session.state
          : project
            ? "captured"
            : "idle",
      elapsedSeconds: this.session?.elapsedSeconds ?? project?.rawDurationSeconds ?? 0,
      segmentCount: this.session?.segmentCount ?? this.segmentCount,
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

    this.semanticSource = options.semanticSource;
    this.windowMetadata = options.windowMetadata;
    this.segmentCount = 0;
    this.session = new HumanRecorderSession({
      capture: options.capture,
      captureBackend: "dda",
      fps: options.fps === 30 ? 30 : 60,
      cursorMode: options.showCursor === false ? "hidden" : "native",
      maxDurationSeconds: 3_600,
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
      this.segmentCount = session.segmentCount;
      this.session = undefined;
      this.semanticSource = undefined;
      this.windowMetadata = undefined;
      return this.status();
    } catch (error) {
      this.session = undefined;
      this.semanticSource = undefined;
      this.windowMetadata = undefined;
      throw error;
    }
  }

  async save(payload) {
    if (!this.project) throw new Error("Não há gravação pronta para salvar.");
    if (this.rendering) throw new Error("A gravação já está sendo salva.");
    const requested = String(payload?.outputFile ?? "");
    if (!requested) throw new TypeError("O caminho de saída não foi informado.");
    const outputFile = extname(requested).toLocaleLowerCase() === ".mp4" ? requested : `${requested}.mp4`;
    const project = this.project;
    this.rendering = true;
    try {
      const rendered = await renderScreenProject(project, {
        outPrefix: outputFile.slice(0, -4),
        width: project.capture.encodedSize?.width ?? project.capture.bounds.width,
        height: project.capture.encodedSize?.height ?? project.capture.bounds.height,
        fps: project.capture.requestedFps,
        camera: [],
        cursor: { clickIndicator: false },
        keepIntermediates: false,
      });
      this.project = undefined;
      this.segmentCount = 0;
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
      case "start": return await this.start(payload);
      case "pause-resume": return await this.pauseOrResume();
      case "stop": return await this.stop();
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
  process.stdout.write(`${PROTOCOL_PREFIX}${JSON.stringify(message)}\n`);
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

process.on("SIGTERM", () => {
  void worker.cleanup().finally(() => process.exit(0));
});

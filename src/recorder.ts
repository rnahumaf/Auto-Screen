import { readFile, rm, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { Button, Point as NutPoint, mouse } from "@nut-tree-fork/nut-js";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { probeMedia, resolveFfmpegPath } from "./ffmpeg.js";
import { spawnProcess } from "./process.js";
import { validateRecorderConfig } from "./validation.js";
import { resolveCaptureBounds } from "./windows.js";
import type {
  CaptureProject, InputControlOptions, MouseButton, MovementEasing, Point, PointerSample,
  RecordedAction, RecorderConfig, Rect, TimelineMark,
} from "./types.js";

const DEFAULT_FPS = 30;
const DEFAULT_MAX_DURATION_SECONDS = 300;
const POINTER_SAMPLE_INTERVAL_MS = 100;

function ease(value: number, kind: MovementEasing): number {
  if (kind === "ease-in") return value * value;
  if (kind === "ease-out") return 1 - (1 - value) ** 2;
  if (kind === "ease-in-out") return value < 0.5 ? 2 * value * value : 1 - ((-2 * value + 2) ** 2) / 2;
  return value;
}

function contains(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}

function buttonValue(button: MouseButton): Button {
  if (button === "right") return Button.RIGHT;
  if (button === "middle") return Button.MIDDLE;
  return Button.LEFT;
}

export class ScreenRecorderSession {
  readonly config: RecorderConfig;
  private process?: ChildProcessWithoutNullStreams;
  private processExit?: Promise<{ code: number; stderr: string }>;
  private startedAt = 0;
  private workDirectory = "";
  private rawVideoPath = "";
  private workDirectoryToken = "";
  private bounds?: Rect;
  private dpi = 96;
  private input?: string;
  private pointerTimer?: NodeJS.Timeout;
  private maxTimer?: NodeJS.Timeout;
  private sampling = false;
  private stopped = false;
  private abortedReason?: Error;
  private readonly actions: RecordedAction[] = [];
  private readonly pointerPath: PointerSample[] = [];
  private readonly marks: TimelineMark[] = [];
  private readonly warnings: string[] = [];

  constructor(config: RecorderConfig = {}) {
    this.config = validateRecorderConfig(config);
  }

  async start(): Promise<this> {
    if (this.process) throw new Error("A sessão já foi iniciada.");
    if (process.platform !== "win32") throw new Error("Auto-Screen 0.1.0 grava somente no Windows.");
    if (this.config.abortSignal?.aborted) throw new Error("A sessão foi cancelada antes de iniciar.");
    const source = this.config.capture ?? { kind: "desktop" as const };
    const resolvedCapture = await resolveCaptureBounds(source);
    this.bounds = resolvedCapture.rect;
    this.dpi = resolvedCapture.dpi;
    this.input = resolvedCapture.input;
    const tempRoot = this.config.tempDirectory ? resolve(this.config.tempDirectory) : tmpdir();
    await mkdir(tempRoot, { recursive: true });
    this.workDirectory = await mkdtemp(join(tempRoot, "auto-screen-"));
    this.workDirectoryToken = randomUUID();
    await writeFile(join(this.workDirectory, ".auto-screen-workdir"), this.workDirectoryToken, "utf8");
    this.rawVideoPath = join(this.workDirectory, "capture.mkv");

    const fps = this.config.fps ?? DEFAULT_FPS;
    const ffmpeg = resolveFfmpegPath(this.config.ffmpegPath);
    const args = ["-y", "-hide_banner", "-loglevel", "warning", "-f", "gdigrab", "-draw_mouse", this.config.drawMouse === false ? "0" : "1", "-framerate", String(fps)];
    if (source.kind === "region") {
      args.push("-offset_x", String(source.rect.x), "-offset_y", String(source.rect.y), "-video_size", `${source.rect.width}x${source.rect.height}`);
    }
    args.push("-i", this.input, "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "12", "-pix_fmt", "yuv420p", this.rawVideoPath);
    this.process = spawnProcess(ffmpeg, args);
    let stderr = "";
    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (chunk: string) => { stderr += chunk; });
    this.processExit = new Promise((resolveExit, reject) => {
      this.process?.once("error", reject);
      this.process?.once("close", (code) => resolveExit({ code: code ?? -1, stderr }));
    });
    try { await delay(400, undefined, { signal: this.config.abortSignal }); }
    catch (error) {
      if (this.process.exitCode === null) this.process.kill();
      await this.processExit;
      throw error;
    }
    if (this.process.exitCode !== null) {
      const exit = await this.processExit;
      throw new Error(`FFmpeg não iniciou a captura: ${exit.stderr.trim()}`);
    }
    this.startedAt = performance.now();
    this.pointerTimer = setInterval(() => { void this.samplePointer(); }, POINTER_SAMPLE_INTERVAL_MS);
    this.maxTimer = setTimeout(() => this.abort(new Error("A sessão atingiu a duração máxima configurada.")), (this.config.maxDurationSeconds ?? DEFAULT_MAX_DURATION_SECONDS) * 1_000);
    this.config.abortSignal?.addEventListener("abort", () => this.abort(new Error("A sessão foi cancelada.")), { once: true });
    await this.samplePointer();
    return this;
  }

  async moveMouse(point: Point, options: { durationMs?: number; easing?: MovementEasing } = {}): Promise<void> {
    this.assertControl(point);
    const requested = this.now();
    const start = await mouse.getPosition();
    const durationMs = options.durationMs ?? 350;
    const easing = options.easing ?? "ease-in-out";
    const steps = Math.max(1, Math.ceil(durationMs / 16));
    for (let index = 1; index <= steps; index += 1) {
      this.assertUsable();
      const progress = ease(index / steps, easing);
      const x = Math.round(start.x + (point.x - start.x) * progress);
      const y = Math.round(start.y + (point.y - start.y) * progress);
      await mouse.setPosition(new NutPoint(x, y));
      if (durationMs > 0) await delay(durationMs / steps, undefined, { signal: this.config.abortSignal });
    }
    this.record("moveMouse", requested, { ...point, durationMs, easing });
  }

  async click(options: { button?: MouseButton; count?: 1 | 2; holdMs?: number } = {}): Promise<void> {
    this.assertControl(await mouse.getPosition());
    const requested = this.now();
    const button = options.button ?? "left";
    const count = options.count ?? 1;
    const nativeButton = buttonValue(button);
    if ((options.holdMs ?? 0) > 0) {
      await mouse.pressButton(nativeButton);
      try { await delay(options.holdMs, undefined, { signal: this.config.abortSignal }); }
      finally { await mouse.releaseButton(nativeButton); }
    } else if (count === 2) await mouse.doubleClick(nativeButton);
    else await mouse.click(nativeButton);
    this.record("click", requested, { button, count, holdMs: options.holdMs ?? 0 });
  }

  async scroll(options: { deltaX?: number; deltaY?: number; durationMs?: number }): Promise<void> {
    this.assertControl(await mouse.getPosition());
    if (options.deltaX === undefined && options.deltaY === undefined) throw new TypeError("Informe deltaX ou deltaY.");
    const requested = this.now();
    const durationMs = options.durationMs ?? 0;
    const x = Math.trunc(options.deltaX ?? 0);
    const y = Math.trunc(options.deltaY ?? 0);
    const total = Math.max(Math.abs(x), Math.abs(y), 1);
    const batches = durationMs > 0 ? Math.min(total, Math.max(1, Math.ceil(durationMs / 30))) : 1;
    for (let index = 0; index < batches; index += 1) {
      const nextX = Math.round(Math.abs(x) * (index + 1) / batches) - Math.round(Math.abs(x) * index / batches);
      const nextY = Math.round(Math.abs(y) * (index + 1) / batches) - Math.round(Math.abs(y) * index / batches);
      if (nextX > 0) await (x > 0 ? mouse.scrollRight(nextX) : mouse.scrollLeft(nextX));
      if (nextY > 0) await (y > 0 ? mouse.scrollDown(nextY) : mouse.scrollUp(nextY));
      if (durationMs > 0) await delay(durationMs / batches, undefined, { signal: this.config.abortSignal });
    }
    this.record("scroll", requested, { deltaX: x, deltaY: y, durationMs });
  }

  async wait(durationMs: number): Promise<void> {
    this.assertUsable();
    if (!Number.isFinite(durationMs) || durationMs < 0) throw new RangeError("durationMs deve ser finito e não negativo.");
    const requested = this.now();
    await delay(durationMs, undefined, { signal: this.config.abortSignal });
    this.record("wait", requested, { durationMs });
  }

  mark(id: string, intensity = 0.5): void {
    this.assertUsable();
    if (!id) throw new TypeError("A marca precisa de um id.");
    if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) throw new RangeError("A intensidade deve ficar entre 0 e 1.");
    const timeSeconds = this.now();
    this.marks.push({ id, timeSeconds, intensity });
    this.record("mark", timeSeconds, { id, intensity });
  }

  async stop(): Promise<CaptureProject> {
    if (!this.process || !this.processExit || !this.bounds || !this.input) throw new Error("A sessão não foi iniciada.");
    if (this.stopped) throw new Error("A sessão já foi encerrada.");
    this.stopped = true;
    if (this.pointerTimer) clearInterval(this.pointerTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    await this.samplePointer();
    if (this.process.exitCode === null && !this.process.killed) this.process.stdin.write("q\n");
    const exit = await this.processExit;
    if (exit.code !== 0 && !this.abortedReason) throw new Error(`A captura falhou: ${exit.stderr.trim()}`);
    if (this.abortedReason) throw this.abortedReason;
    const ffmpeg = resolveFfmpegPath(this.config.ffmpegPath);
    const probe = await probeMedia(this.rawVideoPath, ffmpeg);
    if (probe.durationSeconds <= 0) throw new Error("O vídeo capturado não tem duração válida.");
    return {
      schemaVersion: 1,
      platform: "win32",
      createdAt: new Date().toISOString(),
      rawVideoPath: this.rawVideoPath,
      workDirectory: this.workDirectory,
      workDirectoryToken: this.workDirectoryToken,
      capture: {
        source: this.config.capture ?? { kind: "desktop" },
        bounds: this.bounds,
        fps: this.config.fps ?? DEFAULT_FPS,
        drawMouse: this.config.drawMouse !== false,
        dpi: this.dpi,
      },
      rawDurationSeconds: probe.durationSeconds,
      actions: [...this.actions],
      pointerPath: [...this.pointerPath],
      marks: [...this.marks],
      warnings: [...this.warnings],
    };
  }

  private async samplePointer(): Promise<void> {
    if (!this.process || this.stopped && this.pointerPath.length > 0 || this.sampling || this.startedAt === 0) return;
    this.sampling = true;
    try {
      const point = await mouse.getPosition();
      this.pointerPath.push({ x: point.x, y: point.y, timeSeconds: this.now() });
    } catch (error) {
      this.warnings.push(`Não foi possível amostrar o cursor: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.sampling = false;
    }
  }

  private record(type: RecordedAction["type"], requestedAtSeconds: number, details: Record<string, unknown>): void {
    const actualAtSeconds = this.now();
    this.actions.push({ type, requestedAtSeconds, actualAtSeconds, durationSeconds: actualAtSeconds - requestedAtSeconds, details });
  }

  private now(): number { return Math.max(0, (performance.now() - this.startedAt) / 1_000); }

  private assertUsable(): void {
    if (!this.process || this.startedAt === 0) throw new Error("A sessão ainda não foi iniciada.");
    if (this.stopped || this.abortedReason) throw this.abortedReason ?? new Error("A sessão já foi encerrada.");
  }

  private assertControl(point: Point): void {
    this.assertUsable();
    const control: InputControlOptions = this.config.inputControl ?? {};
    if (!control.enabled) throw new Error("O controle de entrada está desabilitado. Use inputControl.enabled: true conscientemente.");
    const allowed = control.allowedRegion ?? this.bounds;
    if (!allowed || !contains(allowed, point)) throw new RangeError("A ação do mouse está fora da região autorizada.");
  }

  private abort(reason: Error): void {
    if (this.stopped || this.abortedReason) return;
    this.abortedReason = reason;
    if (this.process?.exitCode === null) this.process.kill();
  }
}

export function createScreenRecorder(config: RecorderConfig = {}): ScreenRecorderSession {
  return new ScreenRecorderSession(config);
}

export async function cleanupScreenProject(project: CaptureProject): Promise<void> {
  const resolved = resolve(project.workDirectory);
  if (!basename(resolved).startsWith("auto-screen-")) throw new Error("Diretório sem prefixo seguro do Auto-Screen.");
  if (dirname(resolve(project.rawVideoPath)) !== resolved) throw new Error("O vídeo bruto não pertence ao diretório temporário informado.");
  const marker = await readFile(join(resolved, ".auto-screen-workdir"), "utf8");
  if (!project.workDirectoryToken || marker !== project.workDirectoryToken) throw new Error("Token do diretório temporário inválido.");
  await rm(resolved, { recursive: true, force: true });
}
